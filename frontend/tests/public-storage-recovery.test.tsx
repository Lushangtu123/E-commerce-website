import { act, fireEvent, screen, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import ProductCard from '@/components/ProductCard';
import api, { type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: navigation.id }), useRouter: () => navigation }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const product: Product = { product_id: 1, title: '公开商品', title_en: 'Public product', price: 10, stock: 3, sales_count: 0, rating: 5, review_count: 1 };
const originalAdapter = api.defaults.adapter;
beforeEach(() => { navigation.id = '1'; useAuthStore.setState({ isHydrated: true }); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { api.defaults.adapter = originalAdapter; });

function transport(detail: Promise<{ product: Product }> = Promise.resolve({ product })) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async config => {
    calls.push(`${config.method} ${config.url}`);
    const data = config.url === '/products/1' ? await detail
      : config.url === '/products/2' ? { product: { ...product, product_id: 2, title: 'Current product' } }
      : config.url?.startsWith('/reviews/product/') ? { reviews: [{ review_id: 1, rating: 5, content: 'Public review', username: 'Reviewer' }], total: 1, totalPages: 1 }
      : config.url?.startsWith('/recommendations/related/') ? { related_products: [{ ...product, product_id: 3, title: 'Related product', title_en: null }] }
      : config.url?.startsWith('/favorites/check/') ? { is_favorited: false }
      : config.url === '/browse/record' ? {} : undefined;
    if (data === undefined) throw new Error(`Unexpected request ${config.method} ${config.url}`);
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  api.defaults.adapter = adapter;
  return calls;
}
const blockStorage = () => vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError'); });

describe('public product browsing without browser storage', () => {
  it('an anonymous card add guides to sign-in without a request when storage is unavailable', async () => {
    const calls = transport(); blockStorage();
    render(<ProductCard product={product} />);
    await expect(captureHandler(screen.getByRole('button', { name: '加入' }))()).resolves.toBeUndefined();
    expect(navigation.push).toHaveBeenCalledWith('/login');
    expect(calls).toEqual([]);
  });

  it('a signed-in card cannot add or redirect after storage becomes unreadable', async () => {
    useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
    const calls = transport();
    render(<ProductCard product={product} />); blockStorage();
    await expect(captureHandler(screen.getByRole('button', { name: '加入' }))()).resolves.toBeUndefined();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it.each(['zh-CN', 'en'] as const)('loads product, reviews and related items through the real API client in %s', async locale => {
    useLocaleStore.setState({ locale });
    const calls = transport();
    blockStorage();
    useAuthStore.getState().hydrate();
    render(<ProductDetail />); await settle();

    expect(screen.getByRole('heading', { level: 1, name: locale === 'en' ? 'Public product' : '公开商品' })).toBeVisible();
    expect(screen.getByText('Public review')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Related product' })).toBeVisible();
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Add to cart' : '加入购物车' })).toBeEnabled();
    expect(calls.sort()).toEqual(['get /products/1', 'get /recommendations/related/1', 'get /reviews/product/1']);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add to cart' : '加入购物车' })); await settle();
    expect(navigation.push).toHaveBeenCalledWith('/login');
    expect(calls.every(call => call.startsWith('get '))).toBe(true);
  });

  it('keeps signed-in controls locked if storage becomes unreadable while reads are pending', async () => {
    useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
    const pending = deferred<{ product: Product }>();
    const calls = transport(pending.promise);
    render(<ProductDetail initialProduct={product} />); await settle();
    blockStorage();
    await act(async () => pending.resolve({ product: { ...product, title: 'Unverified current response' } })); await settle();
    expect(screen.queryByText('Unverified current response')).toBeNull();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    expect(calls.filter(call => call === 'post /cart')).toHaveLength(0);
  });

  it('ignores an anonymous response if another tab signs in before this tab hydrates', async () => {
    const pending = deferred<{ product: Product }>(); transport(pending.promise);
    render(<ProductDetail initialProduct={product} />); await settle();
    localStorage.setItem('session', 'other-tab-session');
    await act(async () => pending.resolve({ product: { ...product, title: 'Old anonymous response' } })); await settle();
    expect(screen.queryByText('Old anonymous response')).toBeNull();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
  });

  it('ignores late old product reads during anonymous storage failure', async () => {
    const pending = deferred<{ product: Product }>(); transport(pending.promise); blockStorage();
    const view = render(<ProductDetail initialProduct={product} />); await settle();
    navigation.id = '2'; view.rerender(<ProductDetail initialProduct={{ ...product, product_id: 2 }} />); await settle();
    await act(async () => pending.resolve({ product: { ...product, title: 'Old product response' } })); await settle();
    expect(screen.getByRole('heading', { name: 'Current product' })).toBeVisible();
    expect(screen.queryByText('Old product response')).toBeNull();
    expect(within(screen.getByRole('heading', { name: '用户评价' }).parentElement!).getByText('Public review')).toBeVisible();
  });
});
