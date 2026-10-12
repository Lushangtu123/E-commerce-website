import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import api, { productApi, recommendationApi, reviewApi, favoriteApi, browseApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { clickTogether, CommitLog, deferred, render, settle } from './helpers';
const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({ id: navigation.id }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const product: Product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0 };
const related = { ...product, product_id: 2, title: 'Related fixture' };
const section = () => screen.getByRole('heading', { name: /^(相关推荐|Related products)$/ }).parentElement!;
beforeEach(() => {
  navigation.id = '1'; useAuthStore.setState({ isHydrated: true });
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unexpected outbound request'));
  vi.spyOn(productApi, 'getDetail').mockImplementation(async id => ({ product: { ...product, product_id: id } }));
  vi.spyOn(recommendationApi, 'getRelated').mockResolvedValue({ related_products: [related] });
  vi.spyOn(reviewApi, 'listByProduct').mockResolvedValue({ reviews: [], total: 0, totalPages: 0 });
  vi.spyOn(favoriteApi, 'check').mockResolvedValue({ is_favorited: false });
  vi.spyOn(browseApi, 'record').mockResolvedValue({} as never);
});
describe('related product recovery', () => {
  it.each([true, 1])('preserves valid SKU card fields with has_sku=%s and MySQL decimal aggregates', async has_sku => {
    vi.mocked(recommendationApi.getRelated).mockResolvedValue({ related_products: [{ ...related, title_en: 'English related',
      price: '0.00', original_price: null, stock: '4294967294', rating: '4.50', has_sku, main_image: null }] } as never);
    useLocaleStore.setState({ locale: 'en' });
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByText('English related')).toBeVisible(); expect(screen.getByText('¥0.00')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Options' })).toBeEnabled();
    expect(within(section()).queryByRole('alert')).toBeNull();
  });
  it.each([
    { related_products: [null] }, { related_products: [related, related] }, { related_products: [product] },
    { related_products: [{ ...related, title: {} }] }, { related_products: [{ ...related, title_en: {} }] },
    { related_products: [{ ...related, price: {} }] }, { related_products: [{ ...related, price: '1e2' }] },
    { related_products: [{ ...related, stock: 'unknown' }] }, { related_products: [{ ...related, rating: {} }] },
    { related_products: [{ ...related, sales_count: undefined }] }, { related_products: [{ ...related, status: 0 }] },
    { related_products: [{ ...related, has_sku: 'false' }] }, { related_products: [{ ...related, main_image: {} }] },
    { related_products: [{ ...related, original_price: {} }] },
    { related_products: Array.from({ length: 5 }, (_, i) => ({ ...related, product_id: i + 2 })) },
    { related_products: [related], total: 4 }, { related_products: [related], success: false },
    { related_products: [related], error: 'Failed' },
  ])('keeps invalid card data %j in the regional retry state', async response => {
    useLocaleStore.setState({ locale: 'en' });
    vi.mocked(recommendationApi.getRelated).mockResolvedValueOnce(response as never);
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    expect(within(section()).getByRole('alert')).toHaveTextContent('Unable to load recommendations. Please try again.');
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    clickTogether(within(section()).getByRole('button', { name: 'Retry' })); await settle();
    expect(screen.getByText('Related fixture')).toBeVisible();
    expect(recommendationApi.getRelated).toHaveBeenCalledTimes(2); expect(productApi.getDetail).toHaveBeenCalledTimes(1);
  });
  it('keeps a missing recommendation list visible as a local error until explicitly retried', async () => {
    vi.mocked(recommendationApi.getRelated).mockResolvedValueOnce({} as never);
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(section()).getByRole('alert')).toHaveTextContent('加载推荐失败，请重试');
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    clickTogether(within(section()).getByRole('button', { name: '重新加载' })); await settle();
    expect(screen.getByText('Related fixture')).toBeVisible();
    expect(recommendationApi.getRelated).toHaveBeenCalledTimes(2);
    expect(productApi.getDetail).toHaveBeenCalledTimes(1); expect(browseApi.record).not.toHaveBeenCalled();
  });
  it('shows loading during an initially empty pending request', async () => {
    const pending = deferred<{ related_products: Product[] }>();
    vi.mocked(recommendationApi.getRelated).mockReturnValueOnce(pending.promise);
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(section()).getByRole('status')).toHaveTextContent('加载中...');
    await act(async () => pending.resolve({ related_products: [related] }));
    expect(screen.getByText('Related fixture')).toBeVisible();
  });
  it.each(['zh-CN', 'en'] as const)('a failed request has a translated error and an independent retry (%s)', async locale => {
    useLocaleStore.setState({ locale });
    vi.mocked(recommendationApi.getRelated).mockRejectedValueOnce(new Error('503'));
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(section()).getByRole('alert')).toHaveTextContent(locale === 'en'
      ? 'Unable to load recommendations. Please try again.' : '加载推荐失败，请重试');
    const retry = within(section()).getByRole('button', { name: locale === 'en' ? 'Retry' : '重新加载' });
    clickTogether(retry, retry); await settle();
    expect(screen.getByText('Related fixture')).toBeVisible();
    expect(within(section()).queryByRole('alert')).toBeNull();
    expect(recommendationApi.getRelated).toHaveBeenCalledTimes(2);
    expect(recommendationApi.getRelated).toHaveBeenLastCalledWith(1, 4);
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
    expect(reviewApi.listByProduct).toHaveBeenCalledTimes(1);
    expect(browseApi.record).not.toHaveBeenCalled();
  });
  it('retry leaves the selected SKU and recorded browse intact', async () => {
    useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
    const variant: Product = { ...product, has_sku: true, skus: [{ sku_id: 11, product_id: 1, sku_code: 'RED', specs: { Color: 'Red' }, price: 10, stock: 3, status: 1 }] };
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: variant });
    vi.mocked(recommendationApi.getRelated).mockRejectedValueOnce(new Error('503'));
    render(<ProductDetail initialProduct={variant} />); await settle();
    fireEvent.change(screen.getByLabelText('商品规格'), { target: { value: '11' } });
    fireEvent.click(within(section()).getByRole('button', { name: '重新加载' })); await settle();
    expect(screen.getByLabelText('商品规格')).toHaveValue('11');
    expect(browseApi.record).toHaveBeenCalledTimes(1);
    expect(favoriteApi.check).toHaveBeenCalledTimes(1);
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
  });
  it('a successful empty response is hidden without an error', async () => {
    vi.mocked(recommendationApi.getRelated).mockResolvedValue({ related_products: [] });
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.queryByRole('heading', { name: '相关推荐' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['success', 'failure'] as const)('ignores a late old-product %s while the new context loads', async outcome => {
    const late = deferred<{ related_products: Product[] }>();
    const fresh = deferred<{ related_products: Product[] }>();
    vi.mocked(recommendationApi.getRelated).mockRejectedValueOnce(new Error('503')).mockReturnValueOnce(late.promise).mockReturnValueOnce(fresh.promise);
    const commits: HTMLElement[] = [];
    const view = render(<CommitLog commits={commits}><ProductDetail initialProduct={product} /></CommitLog>); await settle();
    fireEvent.click(within(section()).getByRole('button', { name: '重新加载' })); await settle();
    navigation.id = '3'; commits.length = 0;
    view.rerender(<CommitLog commits={commits}><ProductDetail initialProduct={{ ...product, product_id: 3 }} /></CommitLog>); await settle();
    expect(commits[0].querySelector('[role="alert"]')).toBeNull();
    await act(async () => outcome === 'success' ? late.resolve({ related_products: [related] }) : late.reject(new Error('503')));
    expect(within(section()).getByRole('status')).toBeVisible();
    expect(screen.queryByText('Related fixture')).toBeNull();
    await act(async () => fresh.resolve({ related_products: [{ ...related, product_id: 4, title: 'New related fixture' }] }));
    expect(screen.getByText('New related fixture')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
