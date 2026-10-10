import { installCatalogRouter } from './catalog-router';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductListView from '@/components/ProductList';
import { productApi, type ProductList } from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>() }));
vi.mock('next/navigation', async () => {
  const { useCatalogSearchParams } = await import('./catalog-router');
  return { useRouter: () => router, useSearchParams: () => useCatalogSearchParams(query) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('@/components/ProductCard', () => ({ default: ({ product }: { product: { title: string } }) => <div>{product.title}</div>, ProductCardSkeleton: () => <div /> }));
vi.mock('@/lib/api', () => ({ productApi: { list: vi.fn(), getCategories: vi.fn(async () => [{ category_id: 3, name: 'Clothing' }]) } }));

const result = { products: [], page: 1, limit: 20, total: 60, totalPages: 3 } as ProductList;
beforeEach(() => { installCatalogRouter(router, query); query.current = new URLSearchParams(); vi.mocked(productApi.list).mockResolvedValue(result); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe('catalog filter form', () => {
  it('keeps editing local, applies all constraints to the URL, and preserves search and sort', async () => {
    query.current = new URLSearchParams({ keyword: 'shirt', sort: 'price ASC', page: '3' });
    render(<ProductListView />);
    await settle();
    change('商品分类', '3'); change('商品品牌', 'Example & Co'); change('最低价（元）', '20.00'); change('最高价（元）', '80');
    expect(productApi.list).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByRole('form', { name: '商品筛选' }));
    const url = new URL(router.push.mock.lastCall![0], 'http://shop.test');
    expect(url.pathname).toBe('/products');
    expect(Object.fromEntries(url.searchParams)).toEqual({ keyword: 'shirt', sort: 'price ASC', category_id: '3', brand: 'Example & Co', min_price: '20', max_price: '80' });
  });

  it('resets only filters and page while keeping the keyword and sort', async () => {
    query.current = new URLSearchParams({ keyword: 'shirt', sort: 'price DESC', brand: 'Example', min_price: '0', category_id: '3', page: '3' });
    render(<ProductListView />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(Object.fromEntries(new URL(router.push.mock.lastCall![0], 'http://shop.test').searchParams)).toEqual({ keyword: 'shirt', sort: 'price DESC' });
    expect(screen.getByLabelText('商品品牌')).toHaveValue('');
  });

  it.each([
    ['-1', '20', '价格须为0至99999999.99，最多两位小数'],
    ['1.001', '20', '价格须为0至99999999.99，最多两位小数'],
    ['1', '100000000', '价格须为0至99999999.99，最多两位小数'],
    ['80', '20', '最高价不能低于最低价'],
  ])('does not navigate for invalid prices %s–%s', async (min, max, message) => {
    render(<ProductListView />); await settle();
    change('最低价（元）', min); change('最高价（元）', max);
    fireEvent.submit(screen.getByRole('form', { name: '商品筛选' }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(productApi.list).toHaveBeenCalledTimes(1);
  });

  it('resets page and draft on a new filtered URL, and ignores a late response for the old filter', async () => {
    const pending = deferred<ProductList>();
    vi.mocked(productApi.list).mockImplementation(params => (params as { brand?: string }).brand === 'New' ? pending.promise : Promise.resolve({ ...result, products: [{ product_id: 1, title: 'Old item' }] } as ProductList));
    query.current = new URLSearchParams({ brand: 'Old' });
    const view = render(<ProductListView />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '3' })); await settle();
    change('商品品牌', 'Unsaved');
    query.current = new URLSearchParams({ brand: 'New', min_price: '0' });
    view.rerender(<ProductListView />); await settle();
    expect(screen.queryByText('Old item')).not.toBeInTheDocument();
    expect(screen.getByLabelText('商品品牌')).toHaveValue('New');
    expect(vi.mocked(productApi.list).mock.lastCall![0]).toMatchObject({ brand: 'New', min_price: 0, page: 1 });
    await act(async () => pending.resolve({ ...result, products: [{ product_id: 2, title: 'New item' }] } as ProductList));
    await settle();
    expect(screen.getByText('New item')).toBeInTheDocument();
  });

  it('keeps the selected category while categories are unavailable and supports a read retry', async () => {
    vi.mocked(productApi.getCategories).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([{ category_id: 3, name: 'Clothing' }]);
    query.current = new URLSearchParams({ category_id: '3' });
    render(<ProductListView />); await settle();
    expect(screen.getByLabelText('商品分类')).toHaveValue('3');
    expect(productApi.list).toHaveBeenCalledWith({ keyword: '', sort: 'created_at DESC', category_id: 3, page: 1, limit: 20 });
    fireEvent.click(screen.getByRole('button', { name: '重试' })); await settle();
    expect(screen.getByRole('option', { name: 'Clothing' })).toBeInTheDocument();
    expect(productApi.getCategories).toHaveBeenCalledTimes(2);
  });

  it('renders English labels and validation feedback', async () => {
    vi.mocked(productApi.getCategories).mockResolvedValue([{ category_id: 3, name: '电子产品' }]);
    act(() => useLocaleStore.getState().setLocale('en'));
    render(<ProductListView />); await settle();
    change('Minimum price (CNY)', '80'); change('Maximum price (CNY)', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum price must be at least the minimum price');
    expect(screen.getByLabelText('Product category')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Electronics' })).toBeInTheDocument();
  });
});
