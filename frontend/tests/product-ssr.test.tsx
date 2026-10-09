import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProductPage from '@/app/products/[id]/page';
import ProductDetail from '@/components/ProductDetail';
import { browseApi, cartApi, favoriteApi, productApi, type Product } from '@/lib/api';
import { fetchApiResult, type ApiResult } from '@/lib/site';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { apiError, captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const NOT_FOUND = vi.hoisted(() => new Error('NEXT_NOT_FOUND'));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1' }), notFound: () => { throw NOT_FOUND; } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: vi.fn(), success: vi.fn() };
  return { default: toast, toast };
});
vi.mock('@/components/ProductCard', () => ({ default: () => null }));
vi.mock('@/lib/api', () => ({
  productApi: { getDetail: vi.fn() },
  cartApi: { add: vi.fn(async ({ add_key }) => ({ message: '添加成功', add_key, replayed: false })),
    list: vi.fn(async () => ({ items: [{ cart_id: 7, product_id: 1, quantity: 1, title: 'Server shirt', price: '19.90', stock: 5 }] })) },
  reviewApi: { listByProduct: vi.fn(async () => ({ reviews: [], total: 0, totalPages: 0 })) },
  recommendationApi: { getRelated: vi.fn(async () => ({ related_products: [] })) },
  favoriteApi: { check: vi.fn(async () => ({ is_favorited: false })), add: vi.fn(async () => ({ message: '收藏成功' })), remove: vi.fn(async () => ({ message: '取消收藏成功' })) },
  browseApi: { record: vi.fn(async () => ({})) },
}));
// The page reads through the same cached fetchApiResult as the layout; the seo-pages tests cover the real one.
vi.mock('@/lib/site', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/site')>(), fetchApiResult: vi.fn() }));

type Detail = { product: Product };
const customer = { user_id: 1, username: 'buyer', email: 'buyer@example.test' };
const serverCopy: Product = { product_id: 1, title: 'Server shirt', description: 'Soft cotton', price: '19.90', stock: 5, sales_count: 3, rating: 4.5, main_image: '/shirt.jpg' };

/** Renders the server page the way Next does: the async page first, then its element to HTML. */
async function serverRender(result: ApiResult<{ product?: Product }>) {
  vi.mocked(fetchApiResult).mockResolvedValue(result);
  const element = await ProductPage({ params: Promise.resolve({ id: '1' }) }) as ReactElement;
  const container = document.createElement('div');
  container.innerHTML = renderToString(element);
  return { element, container };
}

const addButton = (root: HTMLElement = document.body) => within(root).getByRole<HTMLButtonElement>('button', { name: '加入购物车' });

describe('server-rendered product page', () => {
  it('puts the product into the server HTML with its purchase controls locked', async () => {
    const { container } = await serverRender({ kind: 'ok', data: { product: serverCopy } });

    expect(container.textContent).toContain('Server shirt');
    expect(container.textContent).toContain('¥19.90');
    expect(container.textContent).toContain('Soft cotton');
    expect(container.querySelector('.grid[aria-busy="true"]'), 'the product itself must be readable while reviews load').toBeNull();
    expect(addButton(container)).toBeDisabled();
    expect(within(container).getByRole('button', { name: '收藏' })).toBeDisabled();
  });

  it('falls back to the loading skeleton when the API is unreachable', async () => {
    const { container } = await serverRender({ kind: 'unavailable' });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Server shirt');
  });

  it('gives a missing product a real 404', async () => {
    vi.mocked(fetchApiResult).mockResolvedValue({ kind: 'missing', status: 404 });
    await expect(ProductPage({ params: Promise.resolve({ id: '1' }) })).rejects.toBe(NOT_FOUND);
  });

  it('hydrates the server HTML without a mismatch, then unlocks with the client copy', async () => {
    const { element, container } = await serverRender({ kind: 'ok', data: { product: serverCopy } });
    const client = deferred<Detail>();
    vi.mocked(productApi.getDetail).mockReturnValue(client.promise);
    const mismatches: unknown[] = [];
    document.body.appendChild(container);
    const root = await act(async () => hydrateRoot(container, element, { onRecoverableError: error => { mismatches.push(error); } }));

    expect(mismatches).toEqual([]);
    expect(screen.getByText('Server shirt')).toBeInTheDocument();
    act(() => useAuthStore.getState().login(customer, 'buyer-session'));
    await settle();
    expect(addButton()).toBeDisabled();

    await act(async () => client.resolve({ product: { ...serverCopy, price: '17.00' } }));
    await settle();
    expect(screen.getByText('¥17.00')).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
    act(() => root.unmount());
    container.remove();
  });

  it('cannot add the server copy to the cart before the client has loaded the product', async () => {
    const client = deferred<Detail>();
    vi.mocked(productApi.getDetail).mockReturnValue(client.promise);
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={serverCopy} />);
    await settle();
    const early = captureHandler(addButton());
    const earlyFavorite = captureHandler(screen.getByRole('button', { name: '收藏' }));

    expect(await early()).toBe(false);
    await earlyFavorite();
    await settle();
    expect(cartApi.add).not.toHaveBeenCalled();
    expect(favoriteApi.add).not.toHaveBeenCalled(); expect(favoriteApi.remove).not.toHaveBeenCalled();

    await act(async () => client.resolve({ product: serverCopy }));
    await settle();
    await act(async () => { addButton().click(); });
    await settle();
    expect(cartApi.add).toHaveBeenCalledWith({ product_id: 1, quantity: 1, add_key: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(cartApi.list).toHaveBeenCalledOnce();
  });

  it("never shows another product's server copy", async () => {
    vi.mocked(productApi.getDetail).mockReturnValue(deferred<Detail>().promise);
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={{ ...serverCopy, product_id: 2, title: 'Other product' }} />);
    await settle();

    expect(screen.queryByText('Other product')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it.each([
    ['a network failure', Object.assign(new Error('Network Error'), { response: undefined }), false],
    ['a server error', Object.assign(apiError('服务暂不可用'), { response: { status: 500, data: { error: '服务暂不可用' } } }), false],
    ['a deleted product', Object.assign(apiError('商品不存在'), { response: { status: 404, data: { error: '商品不存在' } } }), true],
  ])('after %s on the client, keeps a readable server copy unless the product is gone', async (_, failure, leaves) => {
    vi.mocked(productApi.getDetail).mockRejectedValue(failure);
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={serverCopy} />);
    await settle();

    if (leaves) {
      expect(router.push).toHaveBeenCalledWith('/products');
      expect(toast.error).toHaveBeenCalledWith('商品不存在');
    } else {
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.getByText('Server shirt')).toBeInTheDocument();
      expect(addButton()).toBeDisabled();
      expect(toast.error).toHaveBeenCalledWith('加载商品失败');
    }
  });

  it.each([
    ['the server copy', serverCopy],
    ['no server copy', undefined],
    ["another product's server copy", { ...serverCopy, product_id: 2 }],
  ])('recovers after a failed client load with %s without recording another browse', async (_, initialProduct) => {
    const retry = deferred<Detail>();
    vi.mocked(productApi.getDetail).mockRejectedValueOnce(new Error('Network Error')).mockReturnValueOnce(retry.promise);
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={initialProduct} />);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    const retryRead = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    void retryRead();
    void retryRead();
    await settle();
    expect(productApi.getDetail).toHaveBeenCalledTimes(2);
    expect(browseApi.record).toHaveBeenCalledTimes(1);
    if (initialProduct === serverCopy) expect(addButton()).toBeDisabled();
    expect(cartApi.add).not.toHaveBeenCalled();

    await act(async () => retry.resolve({ product: { ...serverCopy, price: '12.00', stock: 2 } }));
    await settle();
    expect(screen.getByText('¥12.00')).toBeInTheDocument();
    expect(screen.getByText('库存 2 件')).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(browseApi.record).toHaveBeenCalledTimes(1);
  });

  it('keeps a repeated failure retryable and still leaves a product deleted during retry', async () => {
    vi.mocked(productApi.getDetail).mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Still offline'))
      .mockRejectedValueOnce(Object.assign(apiError('商品不存在'), { response: { status: 404 } }));
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={serverCopy} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(addButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/products');
    expect(browseApi.record).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)('ignores a late product retry %s after the customer changes', async outcome => {
    const retry = deferred<Detail>();
    vi.mocked(productApi.getDetail).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ product: { ...serverCopy, title: 'Current customer copy', price: '7.00' } });
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<ProductDetail initialProduct={serverCopy} />);
    await settle();
    const staleRetry = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    void staleRetry();
    await settle();
    act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'second-session'));
    await settle();

    await act(async () => {
      if (outcome === 'success') retry.resolve({ product: { ...serverCopy, title: 'Old customer copy' } });
      else retry.reject(new Error('Old customer failed'));
    });
    await staleRetry();
    await settle();
    expect(screen.getByText('Current customer copy')).toBeInTheDocument();
    expect(screen.queryByText('Old customer copy')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(productApi.getDetail).toHaveBeenCalledTimes(3);
    expect(addButton()).toBeEnabled();
  });

  it.each(['storage', 'unmount'] as const)('ignores a late product retry after a %s change', async change => {
    const retry = deferred<Detail>();
    vi.mocked(productApi.getDetail).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
    useAuthStore.getState().login(customer, 'buyer-session');
    const view = render(<ProductDetail initialProduct={serverCopy} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    if (change === 'storage') localStorage.setItem('session', 'other-session');
    else view.unmount();

    await act(async () => retry.resolve({ product: { ...serverCopy, title: 'Ignored retry copy' } }));
    expect(screen.queryByText('Ignored retry copy')).not.toBeInTheDocument();
    expect(cartApi.add).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
