import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '@/components/AppShell';
import ProductDetail from '@/components/ProductDetail';
import api, { productApi, reviewApi, recommendationApi, type Product } from '@/lib/api';
import { LOCALE_STORAGE_KEY, useLocaleStore } from '@/store/useLocaleStore';
import { deferred, render, settle } from './helpers';
const navigation = vi.hoisted(() => ({ id: '1', pathname: '/products/1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({ id: navigation.id }), usePathname: () => navigation.pathname }));
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));
const product: Product = { product_id: 1, title: '棉质衬衫', title_en: 'Cotton shirt', price: 10, stock: 3, sales_count: 0, rating: 0 };
beforeEach(() => {
  navigation.id = '1'; navigation.pathname = '/products/1'; document.title = `${product.title} | 电商平台`;
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unexpected outbound request'));
  vi.spyOn(productApi, 'getDetail').mockResolvedValue({ product });
  vi.spyOn(reviewApi, 'listByProduct').mockResolvedValue({ reviews: [], total: 0, totalPages: 0 });
  vi.spyOn(recommendationApi, 'getRelated').mockResolvedValue({ related_products: [] });
});
const page = (value: Product | null = product) => <AppShell><ProductDetail initialProduct={value} /></AppShell>;
describe('current product browser title', () => {
  it('uses English product content and switches back to its literal Chinese title', async () => {
    render(page()); await settle();
    expect(screen.getByRole('heading', { name: 'Cotton shirt' })).toBeVisible();
    expect(document.title).toBe('Cotton shirt | Shop');
    act(() => useLocaleStore.getState().setLocale('zh-CN')); await settle();
    expect(document.title).toBe('棉质衬衫 | 电商平台');
    act(() => useLocaleStore.getState().setLocale('en')); await settle();
    expect(document.title).toBe('Cotton shirt | Shop');
  });
  it('does not lose the English title when Next streams Chinese metadata afterwards', async () => {
    render(page()); await settle();
    await act(async () => { document.title = '棉质衬衫 | 电商平台'; }); await settle();
    expect(document.title).toBe('Cotton shirt | Shop');
  });
  it('updates after initially unavailable product content arrives', async () => {
    const pending = deferred<{ product: Product }>(); vi.mocked(productApi.getDetail).mockReturnValue(pending.promise);
    document.title = '商品详情 | 电商平台'; render(page(null)); await settle();
    await act(async () => pending.resolve({ product })); await settle();
    expect(document.title).toBe('Cotton shirt | Shop');
  });
  it('treats product names literally and falls back when an English translation is absent', async () => {
    const value = { ...product, title: '登录 | 特别款', title_en: null };
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: value }); render(page(value)); await settle();
    expect(document.title).toBe('登录 | 特别款 | Shop');
  });
  it('keeps separators inside an English product name', async () => {
    const value = { ...product, title_en: 'Cotton | Limited shirt' };
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: value }); render(page(value)); await settle();
    expect(document.title).toBe('Cotton | Limited shirt | Shop');
  });
  it('a new product controls its title while late old content is ignored', async () => {
    const old = deferred<{ product: Product }>(); vi.mocked(productApi.getDetail).mockReturnValueOnce(old.promise);
    const view = render(page()); await settle();
    const next = { ...product, product_id: 2, title: '外套', title_en: 'Coat' };
    navigation.id = '2'; navigation.pathname = '/products/2'; vi.mocked(productApi.getDetail).mockResolvedValue({ product: next });
    view.rerender(page(next)); await settle();
    await act(async () => old.resolve({ product })); await settle();
    expect(document.title).toBe('Coat | Shop');
  });
  it('releases product title ownership when navigating to a static page', async () => {
    const view = render(page()); await settle();
    navigation.pathname = '/login'; view.rerender(<AppShell><h1>Login page</h1></AppShell>);
    await act(async () => { document.title = '登录 | 电商平台'; }); await settle();
    expect(document.title).toBe('Sign in | Shop');
  });
});
