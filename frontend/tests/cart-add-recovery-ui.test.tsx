import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '@/components/AppShell';
import ProductDetail from '@/components/ProductDetail';
import { cartApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1' }), usePathname: () => '/products/1' }));
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/components/RelatedProducts', () => ({ default: () => null }));
vi.mock('@/components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));
vi.mock('react-hot-toast', () => ({ Toaster: () => null, default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  productApi: { getDetail: vi.fn(async () => ({ product: { product_id: 1, title: 'Item', price: 10, stock: 20, has_sku: true,
    skus: [{ sku_id: 5, product_id: 1, sku_code: 'RED', specs: { Color: 'Red' }, price: 12, stock: 10, status: 1 },
      { sku_id: 6, product_id: 1, sku_code: 'BLUE', specs: { Color: 'Blue' }, price: 15, stock: 10, status: 1 }] } })) },
  cartApi: { add: vi.fn(async ({ add_key }) => ({ message: '添加成功', add_key, replayed: true })), list: vi.fn(async () => ({ items: [] })) },
  reviewApi: { listByProduct: vi.fn(async () => ({ reviews: [], total: 0 })) },
  recommendationApi: { getRelated: vi.fn(async () => ({ related_products: [] })) },
  favoriteApi: { check: vi.fn(async () => ({ is_favorited: false })) }, browseApi: { record: vi.fn(async () => ({})) },
}));
const key = '00000000-0000-4000-8000-000000000001';
const input = { product_id: 1, quantity: 2, sku_id: 5 };
const signIn = (id = 1) => useAuthStore.getState().login({ user_id: id, username: 'Buyer', email: 'buyer@test' }, `buyer-${id}`);
const save = () => sessionStorage.setItem('pending-cart-add:buyer-1:1', JSON.stringify({ key, input }));

describe('cart add recovery across views', () => {
  it('restores an intent on reload without POST and only explicitly retries its saved payload', async () => {
    signIn(); save(); const view = render(<AppShell><div>Another page</div></AppShell>); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('商品 #1');
    expect(screen.getByRole('alert')).toHaveTextContent('规格 #5'); expect(screen.getByRole('alert')).toHaveTextContent('2');
    expect(cartApi.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试原添加' })); await settle();
    expect(cartApi.add).toHaveBeenCalledExactlyOnceWith({ ...input, add_key: key });
    expect(useCartStore.getState().items).toEqual([]); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount(); render(<AppShell>Reloaded</AppShell>); await settle(); expect(cartApi.add).toHaveBeenCalledTimes(1);
  });
  it('hides another account intent and suppresses late retry effects after logout', async () => {
    signIn(); save(); render(<AppShell>Page</AppShell>); await settle();
    const response = deferred<never>(); vi.mocked(cartApi.add).mockReturnValue(response.promise);
    fireEvent.click(screen.getByRole('button', { name: '重试原添加' })); await settle();
    act(() => useAuthStore.getState().logout()); await settle();
    response.resolve({ add_key: key, replayed: true } as never); await settle();
    expect(cartApi.list).not.toHaveBeenCalled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => signIn(2)); await settle(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('pending-cart-add:buyer-1:1')).not.toBeNull();
  });
  it('blocks a malformed receipt and translates the recovery state', async () => {
    signIn(); save(); render(<AppShell>Page</AppShell>); await settle();
    act(() => useLocaleStore.getState().setLocale('en')); await settle();
    expect(screen.getByRole('button', { name: 'Retry original add' })).toBeEnabled();
    vi.mocked(cartApi.add).mockResolvedValue({ add_key: 'different', replayed: true } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry original add' })); await settle();
    expect(cartApi.list).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('unconfirmed');
  });
  it('Buy now preserves the lost SKU intent even when the user changes options, then retries it without navigating', async () => {
    signIn(); const view = render(<AppShell><ProductDetail /></AppShell>); await settle();
    fireEvent.change(screen.getByLabelText('商品规格'), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } }); await settle();
    vi.mocked(cartApi.add).mockRejectedValueOnce(new Error('Lost reply'));
    fireEvent.click(screen.getByRole('button', { name: '立即购买' })); await settle();
    const original = vi.mocked(cartApi.add).mock.calls[0][0];
    expect(original).toMatchObject({ ...input, add_key: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    fireEvent.change(screen.getByLabelText('商品规格'), { target: { value: '6' } }); await settle();
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' })); await settle();
    expect(cartApi.add).toHaveBeenCalledTimes(1); expect(router.push).not.toHaveBeenCalled();
    view.unmount(); render(<AppShell>Other page</AppShell>); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重试原添加' })); await settle();
    expect(vi.mocked(cartApi.add).mock.calls[1][0]).toEqual(original); expect(router.push).not.toHaveBeenCalled();
  });
});
