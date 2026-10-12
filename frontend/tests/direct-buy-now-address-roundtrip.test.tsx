import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { productApi, cartApi, addressApi, orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '1' }), useRouter: () => router, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  productApi: { getDetail: vi.fn() }, cartApi: { add: vi.fn(), list: vi.fn() }, addressApi: { list: vi.fn() }, orderApi: { preview: vi.fn(), create: vi.fn() },
  reviewApi: { listByProduct: vi.fn(async () => ({ reviews: [], total: 0 })) }, recommendationApi: { getRelated: vi.fn(async () => ({ related_products: [] })) },
  favoriteApi: { check: vi.fn(async () => ({ is_favorited: false })) }, browseApi: { record: vi.fn(async () => ({})) },
}));

import AddressPage from '@/app/profile/address/page';
function storedDirectPurchase() {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
  const intent = { id: '11111111-1111-4111-8111-111111111111', ready: true, source: 'buy_now', input: { product_id: 1, quantity: 1 } };
  sessionStorage.setItem('buy-now:buyer-session:1', JSON.stringify(intent));
  window.history.replaceState(null, '', `/cart?buy_now=${intent.id}`);
  vi.mocked(productApi.getDetail).mockResolvedValue({ product: { product_id: 1, title: 'Direct purchase', price: 10, stock: 3, status: 1, sales_count: 0, rating: 0 } });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [{ address_id: 41, receiver_name: 'Buyer', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: false }] });
  vi.mocked(orderApi.preview).mockResolvedValue({ original_amount: 10, discount_amount: 0, total_amount: 10, coupon: null, available_coupons: [] });
  vi.mocked(cartApi.list).mockResolvedValue({ items: [] });
  return intent;
}


it('returns from address management to the original direct purchase', async () => {
  const intent = storedDirectPurchase();
  vi.mocked(cartApi.list).mockResolvedValue({ items: [{ cart_id: 2, product_id: 22, title: 'Unrelated cart product', quantity: 3, price: 10, stock: 5 }] });
  const direct = render(<CartPage />); await settle();
  expect(screen.getByRole('heading', { name: '确认本次购买' })).toBeInTheDocument();
  expect(vi.mocked(orderApi.preview).mock.lastCall?.[0].items).toEqual([{ product_id: 1, quantity: 1 }]);
  expect(cartApi.list).not.toHaveBeenCalled();
  const managementHref = screen.getByRole('link', { name: '管理收货地址' }).getAttribute('href');
  expect(managementHref).toBe(`/profile/address?return_to=${encodeURIComponent('/cart?buy_now=' + intent.id)}`);
  direct.unmount(); window.history.pushState(null, '', managementHref!);
  const addresses = render(<AddressPage />); await settle();
  const returnHref = screen.getByRole('link', { name: '返回购物车' }).getAttribute('href');
  expect(returnHref).toBe('/cart?buy_now=' + intent.id);
  addresses.unmount(); window.history.pushState(null, '', returnHref!);
  render(<CartPage />); await settle();
  expect(screen.getByRole('heading', { name: '确认本次购买' })).toBeInTheDocument();
  expect(screen.queryByText('Unrelated cart product')).not.toBeInTheDocument();
  expect(vi.mocked(orderApi.preview).mock.lastCall?.[0].items).toEqual([intent.input]);
  expect(cartApi.list).not.toHaveBeenCalled();
  expect(orderApi.preview).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '结算 (1)' })).toBeEnabled();
  expect(JSON.parse(sessionStorage.getItem('buy-now:buyer-session:1')!)).toEqual(intent);
  expect(orderApi.create).not.toHaveBeenCalled();
  expect(cartApi.add).not.toHaveBeenCalled();
});
