import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductListView from '@/components/ProductList';
import { productApi, type Product, type ProductList } from '@/lib/api';
import { deferred, render, settle } from './helpers';
import { installCatalogRouter } from './catalog-router';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const { useCatalogSearchParams } = await import('./catalog-router');
  return { useRouter: () => router, useSearchParams: () => useCatalogSearchParams(query) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('@/components/ProductCard', () => ({ default: ({ product }: { product: Product }) => <div>{product.title}</div>, ProductCardSkeleton: () => <div data-testid="skeleton" /> }));
vi.mock('@/lib/api', () => ({ productApi: { list: vi.fn(), getCategories: vi.fn(async () => []) } }));
const pageResult = (page: number): ProductList => ({ products: [{ product_id: page, title: `Page ${page}` } as Product], page, limit: 20, total: 60, totalPages: 3 });

beforeEach(() => {
  query.current = new URLSearchParams();
  installCatalogRouter(router, query);
  vi.mocked(productApi.list).mockImplementation(async params => pageResult(Number((params as { page?: number })?.page)));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

it('pushes each selected page into the URL while preserving every applied constraint', async () => {
  const search = { keyword: 'shirt & shorts', category_id: '3', brand: 'Example & Co', min_price: '0', max_price: '80', sort: 'price ASC' };
  query.current = new URLSearchParams(search);
  render(<ProductListView />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '2' })); await settle();
  expect(Object.fromEntries(query.current)).toEqual({ ...search, page: '2' });
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  expect(productApi.list).toHaveBeenLastCalledWith({ keyword: search.keyword, category_id: 3, brand: search.brand, min_price: 0, max_price: 80, sort: search.sort, page: 2, limit: 20 });
  fireEvent.click(screen.getByRole('button', { name: '1' })); await settle();
  expect(Object.fromEntries(query.current)).toEqual(search);
  expect(router.push).toHaveBeenCalledTimes(2);
  expect(router.replace).not.toHaveBeenCalled();
});

it('loads a shared later page immediately and follows browser back and forward URLs', async () => {
  query.current = new URLSearchParams({ keyword: 'shirt', page: '2' });
  const view = render(<ProductListView />); await settle();
  expect(productApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '3' })); await settle();
  expect(query.current.get('page')).toBe('3');
  const navigateHistory = async (page: string) => {
    query.current = new URLSearchParams({ keyword: 'shirt', page });
    act(() => view.rerender(<ProductListView />)); await settle();
    expect(screen.getByText(`Page ${page}`)).toBeInTheDocument();
  };
  await navigateHistory('2'); await navigateHistory('3');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
});

it.each(['0', '-1', '1.5', '1e2', '02', '2147483648', '9007199254740992', 'abc', '', '2&page=3'])('normalizes malformed page %s to a clean first-page URL', async rawPage => {
  query.current = new URLSearchParams(`keyword=shirt&brand=Example&page=${rawPage}`);
  render(<ProductListView />); await settle();
  expect(productApi.list).toHaveBeenCalledTimes(1);
  expect(productApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  expect(Object.fromEntries(query.current)).toEqual({ keyword: 'shirt', brand: 'Example' });
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
});

it('never borrows a server seed from another page of the same search', async () => {
  query.current = new URLSearchParams({ page: '2' });
  vi.mocked(productApi.list).mockReturnValue(deferred<ProductList>().promise);
  render(<ProductListView seed={{ keyword: '', sort: 'created_at DESC', list: pageResult(1) }} />); await settle();
  expect(screen.queryByText('Page 1')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  expect(productApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
});

it('does not let a late old-page shrink response replace a filter navigation waiting to commit', async () => {
  query.current = new URLSearchParams({ keyword: 'shirt', page: '2' });
  const oldRefresh = deferred<ProductList>();
  vi.mocked(productApi.list).mockReturnValue(oldRefresh.promise);
  render(<ProductListView seed={{ keyword: 'shirt', sort: 'created_at DESC', list: pageResult(2) }} />); await settle();
  // Next navigation can suspend on its server response before useSearchParams commits the target.
  router.push.mockImplementation(() => {});
  fireEvent.change(screen.getByLabelText('商品品牌'), { target: { value: 'New brand' } });
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' })); await settle();
  expect(router.push).toHaveBeenCalledTimes(1);
  oldRefresh.resolve({ products: [], page: 2, limit: 20, total: 1, totalPages: 1 }); await settle();
  expect(router.replace).not.toHaveBeenCalled();
  query.current = new URLSearchParams({ keyword: 'shirt', brand: 'New brand' });
  act(() => query.listeners.forEach(listener => listener())); await settle();
  expect(router.replace).not.toHaveBeenCalled();
});
