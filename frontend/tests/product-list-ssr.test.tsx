import { installCatalogRouter } from './catalog-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '@/app/products/page';
import ProductListView from '@/components/ProductList';
import { productApi, type Product, type ProductList } from '@/lib/api';
import { createQueryClient } from '@/lib/query-client';
import { fetchApiResult, type ApiResult } from '@/lib/site';
import { CommitLog, captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const { useCatalogSearchParams } = await import('./catalog-router');
  return { useRouter: () => router, useSearchParams: () => useCatalogSearchParams(query) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: vi.fn(), success: vi.fn() };
  return { default: toast, toast };
});
// Cards have their own tests; here each one only names its product.
vi.mock('@/components/ProductCard', () => ({
  default: ({ product }: { product: Product }) => <div data-testid="product-card">{product.title}</div>,
  ProductCardSkeleton: () => <div data-testid="product-skeleton" />,
}));
vi.mock('@/lib/api', () => ({ productApi: { list: vi.fn(), getCategories: vi.fn(async () => []) } }));
vi.mock('@/lib/site', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/site')>(), fetchApiResult: vi.fn() }));

const list = (titles: string[], totalPages = 1): ProductList =>
  ({ products: titles.map((title, index) => ({ product_id: index + 1, title }) as Product), total: totalPages * 20, page: 1, limit: 20, totalPages });
const cards = (root: ParentNode = document.body) => Array.from(root.querySelectorAll('[data-testid="product-card"]')).map(card => card.textContent);

/** Renders the server page the way Next does: the async page first, then its element to HTML. */
async function serverRender(search: Record<string, string | string[]>, result: ApiResult<ProductList>) {
  query.current = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(item => [key, item])));
  vi.mocked(fetchApiResult).mockResolvedValue(result);
  const element = await ProductsPage({ searchParams: Promise.resolve(search) }) as ReactElement;
  const container = document.createElement('div');
  container.innerHTML = renderToString(<QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>);
  return { element, container };
}

beforeEach(() => { installCatalogRouter(router, query); query.current = new URLSearchParams(); });

describe('server-rendered product list', () => {
  it('keeps sorting, filters and page controls disabled in server HTML before their handlers hydrate', async () => {
    const { container } = await serverRender({ page: '2' }, { kind: 'ok', data: { ...list(['Page two'], 3), page: 2 } });
    expect(container.querySelector('#product-sort')).toBeDisabled();
    for (const control of Array.from(container.querySelectorAll('form input, form select, form button'))) expect(control).toBeDisabled();
    for (const button of Array.from(container.querySelectorAll('button')).filter(button => ['上一页', '下一页', '1', '2', '3'].includes(button.textContent!.trim()))) expect(button).toBeDisabled();
    expect(cards(container)).toEqual(['Page two']);
  });

  it('enables the catalog controls after hydration and applies sorting without a mismatch', async () => {
    const { element, container } = await serverRender({ page: '2' }, { kind: 'ok', data: { ...list(['Page two'], 3), page: 2 } });
    expect(container.querySelector('#product-sort')).toBeDisabled();
    vi.mocked(productApi.list).mockReturnValue(deferred<ProductList>().promise);
    const mismatches: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container,
        <QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>,
        { onRecoverableError: error => mismatches.push(error) }); });
      expect(container.querySelector('#product-sort')).toBeEnabled();
      for (const control of Array.from(container.querySelectorAll('form input, form select, form button'))) expect(control).toBeEnabled();
      expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent!.trim() === '1')).toBeEnabled();
      fireEvent.change(container.querySelector('#product-sort')!, { target: { value: 'price DESC' } });
      expect(router.push).toHaveBeenCalledWith('/products?sort=price+DESC');
      expect(mismatches).toEqual([]);
    } finally { if (root) await act(() => root!.unmount()); }
  });

  it("puts the first page of the URL's search into the server HTML", async () => {
    const { container } = await serverRender({ keyword: '衬衫 & 裤', sort: ['price ASC', 'ignored'] }, { kind: 'ok', data: list(['Linen shirt', 'Cotton shirt'], 3) });

    expect(cards(container)).toEqual(['Linen shirt', 'Cotton shirt']);
    expect(container.textContent).toContain('共找到 60 件商品');
    expect(container.querySelector('[data-testid="product-skeleton"]')).toBeNull();
    const [path, options] = vi.mocked(fetchApiResult).mock.lastCall!;
    const url = new URL(path, 'http://api.test');
    expect(url.pathname).toBe('/products');
    expect(Object.fromEntries(url.searchParams)).toEqual({ keyword: '衬衫 & 裤', sort: 'price ASC', page: '1', limit: '20' });
    expect(options).toEqual({ revalidate: 60 });
  });

  it('falls back to the loading skeleton when the API is unreachable', async () => {
    const { container } = await serverRender({}, { kind: 'unavailable' });
    expect(container.querySelector('[data-testid="product-skeleton"]')).not.toBeNull();
    expect(cards(container)).toEqual([]);
    expect(vi.mocked(fetchApiResult).mock.lastCall![0]).toBe('/products?sort=created_at+DESC&page=1&limit=20');
  });

  it('hydrates the server HTML without a mismatch, then refreshes it in the background', async () => {
    const { element, container } = await serverRender({}, { kind: 'ok', data: list(['Server copy']) });
    const refresh = deferred<ProductList>();
    vi.mocked(productApi.list).mockReturnValue(refresh.promise);
    const mismatches: unknown[] = [];
    document.body.appendChild(container);
    const root = await act(async () => hydrateRoot(container,
      <QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));

    expect(mismatches).toEqual([]);
    expect(cards()).toEqual(['Server copy']);
    expect(productApi.list).toHaveBeenCalledWith({ keyword: '', sort: 'created_at DESC', page: 1, limit: 20 });

    await act(async () => refresh.resolve(list(['Fresh copy'])));
    await settle();
    expect(cards()).toEqual(['Fresh copy']);
    act(() => root.unmount());
    container.remove();
  });

  it('hydrates a later server page when the browser still has an out-of-range cached result', async () => {
    const serverList = { ...list(['Server page two'], 2), page: 2, total: 21 };
    const { element, container } = await serverRender({ keyword: 'shirt', page: '2' }, { kind: 'ok', data: serverList });
    const client = createQueryClient();
    client.setQueryData(['products', 'shirt', 'created_at DESC', {}, 2, undefined],
      { ...list([], 1), page: 2, total: 1 });
    const refresh = deferred<ProductList>();
    vi.mocked(productApi.list).mockReturnValue(refresh.promise);
    const mismatches: unknown[] = [];
    document.body.appendChild(container);
    const root = await act(async () => hydrateRoot(container,
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));
    try {
      expect(mismatches).toEqual([]);
      expect(cards()).toEqual(['Server page two']);
      await act(async () => refresh.resolve(serverList));
      await settle();
      expect(cards()).toEqual(['Server page two']);
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      client.clear();
      container.remove();
    }
  });

  it('hydrates the server snapshot before reading a different valid browser cache', async () => {
    const { element, container } = await serverRender({}, { kind: 'ok', data: list(['Server copy'], 2) });
    const client = createQueryClient();
    client.setQueryData(['products', '', 'created_at DESC', {}, 1, undefined], list(['Cached copy'], 1));
    const refresh = deferred<ProductList>();
    vi.mocked(productApi.list).mockReturnValue(refresh.promise);
    const mismatches: unknown[] = [];
    document.body.appendChild(container);
    const root = await act(async () => hydrateRoot(container,
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));
    try {
      expect(mismatches).toEqual([]);
      expect(cards()).toEqual(['Cached copy']);
      await act(async () => refresh.resolve(list(['Fresh copy'], 2)));
      await settle();
      expect(cards()).toEqual(['Fresh copy']);
    } finally {
      act(() => root.unmount());
      client.clear();
      container.remove();
    }
  });

  it.each(['failed', 'still missing'])('waits for a %s refresh before correcting an old cached missing page', async outcome => {
    const serverList = { ...list(['Server page two'], 2), page: 2, total: 21 };
    const { element, container } = await serverRender({ keyword: 'shirt', page: '2' }, { kind: 'ok', data: serverList });
    const missing = { ...list([], 1), page: 2, total: 1 };
    const client = createQueryClient();
    client.setQueryData(['products', 'shirt', 'created_at DESC', {}, 2, undefined], missing);
    const refresh = deferred<ProductList>();
    vi.mocked(productApi.list).mockImplementation(params => (params as { page: number }).page === 2 ? refresh.promise
      : Promise.resolve(list(['Real first page'], 1)));
    const mismatches: unknown[] = [];
    document.body.appendChild(container);
    const root = await act(async () => hydrateRoot(container,
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));
    try {
      expect(mismatches).toEqual([]);
      expect(cards()).toEqual(['Server page two']);
      expect(router.replace).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome === 'failed') refresh.reject(new Error('Offline'));
        else refresh.resolve(missing);
      });
      await settle();
      if (outcome === 'failed') {
        expect(cards()).toEqual(['Server page two']);
        expect(router.replace).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('加载商品失败');
      } else {
        expect(cards()).toEqual(['Real first page']);
        expect(router.replace).toHaveBeenCalledExactlyOnceWith('/products?keyword=shirt', { scroll: false });
      }
    } finally {
      act(() => root.unmount());
      client.clear();
      container.remove();
    }
  });

  it('keeps the products already shown when the background refresh fails', async () => {
    vi.mocked(productApi.list).mockRejectedValue(new Error('Offline'));
    render(<ProductListView seed={{ keyword: '', sort: 'created_at DESC', list: list(['Server copy']) }} />);
    await settle();

    expect(cards()).toEqual(['Server copy']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('加载商品失败');
  });

  it.each([
    ['another keyword', { keyword: 'other', sort: 'created_at DESC' }],
    ['another sort', { keyword: '', sort: 'price ASC' }],
  ])('never shows the server copy of %s', async (_, seedSearch) => {
    vi.mocked(productApi.list).mockReturnValue(deferred<ProductList>().promise);
    render(<ProductListView seed={{ ...seedSearch, list: list(['Other search']) }} />);
    await settle();

    expect(cards()).toEqual([]);
    expect(screen.getAllByTestId('product-skeleton').length).toBeGreaterThan(0);
  });

  it('loads later pages on the client without showing the server page one in their place', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const second = deferred<ProductList>();
    vi.mocked(productApi.list).mockImplementation(async params => (params as { page: number }).page === 2 ? second.promise
      : list([`Client page ${(params as { page: number }).page}`], 3));
    render(<ProductListView seed={{ keyword: '', sort: 'created_at DESC', list: list(['Server page 1'], 3) }} />);
    await settle();
    expect(cards()).toEqual(['Client page 1']);

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await settle();
    expect(cards()).toEqual([]);
    await act(async () => second.resolve(list(['Client page 2'], 3)));
    await settle();
    expect(cards()).toEqual(['Client page 2']);
    expect(vi.mocked(productApi.list).mock.lastCall?.[0]).toEqual({ keyword: '', sort: 'created_at DESC', page: 2, limit: 20 });
  });

  it('ignores a previous-page handler from a page the list has moved past', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.mocked(productApi.list).mockImplementation(async params => list([`Page ${(params as { page: number }).page}`], 5));
    render(<ProductListView />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await settle();
    const stalePrevious = captureHandler(screen.getByRole('button', { name: '上一页' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await settle();

    await stalePrevious();
    await settle();
    expect(cards()).toEqual(['Page 3']);
  });

  it('falls back to the latest last page when the catalog shrinks without showing a false empty result', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const fallback = deferred<ProductList>();
    let shrunk = false;
    vi.mocked(productApi.list).mockImplementation(async params => {
      const page = (params as { page: number }).page;
      if (page === 3) { shrunk = true; return list([], 2); }
      if (shrunk) return fallback.promise;
      return list([`Page ${page}`], 3);
    });
    const commits: HTMLElement[] = [];
    render(<CommitLog commits={commits}><ProductListView /></CommitLog>);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await settle();

    expect(vi.mocked(productApi.list).mock.lastCall?.[0]).toMatchObject({ page: 2 });
    expect(query.current.get('page')).toBe('2');
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(commits.some(commit => commit.textContent?.includes('暂无商品'))).toBe(false);
    await act(async () => fallback.resolve(list(['Remaining page two'], 2)));
    await settle();
    expect(cards()).toEqual(['Remaining page two']);
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('returns to page one when all products disappear, then shows the true empty result without looping', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    let empty = false;
    vi.mocked(productApi.list).mockImplementation(async params => {
      if ((params as { page: number }).page === 2) empty = true;
      return empty ? { ...list([], 0), total: 0 } : list(['Initial products'], 2);
    });
    render(<ProductListView />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await settle();

    expect(vi.mocked(productApi.list).mock.lastCall?.[0]).toMatchObject({ page: 1 });
    expect(productApi.list).toHaveBeenCalledTimes(3);
    expect(query.current.has('page')).toBe(false);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('暂无商品')).toBeInTheDocument();
  });

  it('shows a truly empty search on page one without requesting it again', async () => {
    vi.mocked(productApi.list).mockResolvedValue({ ...list([], 0), total: 0 });
    render(<ProductListView />);
    await settle();
    expect(screen.getByText('暂无商品')).toBeInTheDocument();
    expect(productApi.list).toHaveBeenCalledTimes(1);
  });
});


describe('catalog filter URL and server rendering', () => {
  it('uses the same category, brand and price constraints for server HTML and hydration', async () => {
    const search = { keyword: 'shirt', category_id: '3', brand: 'Example & Co', min_price: '20', max_price: '80', sort: 'price ASC' };
    const { element, container } = await serverRender(search, { kind: 'ok', data: list(['Filtered shirt']) });
    expect(cards(container)).toEqual(['Filtered shirt']);
    const path = vi.mocked(fetchApiResult).mock.lastCall![0];
    expect(Object.fromEntries(new URL(path, 'http://api.test').searchParams)).toEqual({ ...search, page: '1', limit: '20' });
    const refresh = deferred<ProductList>();
    vi.mocked(productApi.list).mockReturnValue(refresh.promise);
    document.body.appendChild(container);
    const mismatches: unknown[] = [];
    const root = await act(async () => hydrateRoot(container, <QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));
    expect(mismatches).toEqual([]);
    expect(productApi.list).toHaveBeenCalledWith({ keyword: 'shirt', sort: 'price ASC', category_id: 3, brand: 'Example & Co', min_price: 20, max_price: 80, page: 1, limit: 20 });
    act(() => root.unmount());
    container.remove();
  });

  it('does not turn an invalid price range into an unfiltered catalog', async () => {
    const { container } = await serverRender({ min_price: '80', max_price: '20' }, { kind: 'ok', data: list(['Unfiltered item']) });
    expect(fetchApiResult).not.toHaveBeenCalled();
    expect(cards(container)).toEqual([]);
    expect(container.textContent).toContain('最高价不能低于最低价');
    render(<ProductListView />);
    await settle();
    expect(productApi.list).not.toHaveBeenCalled();
  });

  it('never shows a seed belonging to different filters', async () => {
    const { element } = await serverRender({ brand: 'Old brand' }, { kind: 'ok', data: list(['Old brand product']) });
    query.current = new URLSearchParams({ brand: 'New brand' });
    vi.mocked(productApi.list).mockReturnValue(deferred<ProductList>().promise);
    render(element);
    await settle();
    expect(cards()).toEqual([]);
    expect(productApi.list).toHaveBeenCalledWith({ keyword: '', sort: 'created_at DESC', brand: 'New brand', page: 1, limit: 20 });
  });
});

describe('URL page server rendering', () => {
  it('seeds the requested later page and hydrates exactly that page', async () => {
    const pageTwo = { ...list(['Server page two'], 3), page: 2 };
    const { element, container } = await serverRender({ keyword: 'shirt', page: '2' }, { kind: 'ok', data: pageTwo });
    expect(new URL(vi.mocked(fetchApiResult).mock.lastCall![0], 'http://api.test').searchParams.get('page')).toBe('2');
    expect(cards(container)).toEqual(['Server page two']);
    vi.mocked(productApi.list).mockReturnValue(deferred<ProductList>().promise);
    document.body.appendChild(container);
    const mismatches: unknown[] = [];
    const root = await act(async () => hydrateRoot(container, <QueryClientProvider client={createQueryClient()}>{element}</QueryClientProvider>,
      { onRecoverableError: error => { mismatches.push(error); } }));
    expect(mismatches).toEqual([]);
    expect(cards()).toEqual(['Server page two']);
    expect(productApi.list).toHaveBeenCalledWith({ keyword: 'shirt', sort: 'created_at DESC', page: 2, limit: 20 });
    act(() => root.unmount()); container.remove();
  });

  it.each(['0', '1e2', '2147483648', ['2', '3']])('requests a safe first page for malformed server page %s', async page => {
    const { container } = await serverRender({ page }, { kind: 'ok', data: list(['Safe first page'], 3) });
    expect(new URL(vi.mocked(fetchApiResult).mock.lastCall![0], 'http://api.test').searchParams.get('page')).toBe('1');
    expect(cards(container)).toEqual(['Safe first page']);
  });
});
