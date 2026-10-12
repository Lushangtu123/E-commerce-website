import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
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
it.each([undefined, 5])('buys one unit when the existing cart already equals stock, SKU %s', async sku => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
  vi.mocked(productApi.getDetail).mockResolvedValue({ product: { product_id: 1, title: 'Only this purchase', price: 10, stock: 3, status: 1, sales_count: 0, rating: 0,
    ...(sku && { has_sku: true, skus: [{ product_id: 1, sku_id: sku, sku_code: 'RED', specs: { Color: 'Red' }, stock: 3, price: 10, status: 1 }] }) } });
  vi.mocked(cartApi.list).mockResolvedValue({ items: [{ cart_id: 1, product_id: 1, title: 'Only this purchase', price: 10, quantity: 3, stock: 3, ...(sku && { sku_id: sku }) }] });
  vi.mocked(cartApi.add).mockRejectedValue({ response: { status: 400, data: { error: '商品库存不足' } } });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [{ address_id: 41, receiver_name: 'Buyer', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: false }] });
  vi.mocked(orderApi.preview).mockResolvedValue({ original_amount: 10, discount_amount: 0, total_amount: 10, coupon: null, available_coupons: [] });
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  const product = render(<ProductDetail />); await settle();
  if (sku) fireEvent.change(screen.getByLabelText('商品规格'), { target: { value: String(sku) } });
  fireEvent.click(screen.getByRole('button', { name: '立即购买' })); await settle();
  expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/cart\?buy_now=/));
  expect(cartApi.add).not.toHaveBeenCalled();
  const target = router.push.mock.lastCall![0]; product.unmount(); window.history.replaceState(null, '', target);
  render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '结算 (1)' })); await settle();
  expect(orderApi.create).toHaveBeenCalledExactlyOnceWith({ checkout_source: 'buy_now', shipping_address_id: 41,
    checkout_key: new URL(target, 'http://localhost').searchParams.get('buy_now'), items: [{ product_id: 1, quantity: 1, ...(sku && { sku_id: sku }) }], expected_quote: { original_amount: 10, discount_amount: 0, total_amount: 10 } });
  expect(router.push).toHaveBeenLastCalledWith('/orders/55');
});

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

it('retries a failed catalog read without falling back to cart or creating an order', async () => {
  storedDirectPurchase();
  vi.mocked(productApi.getDetail).mockRejectedValueOnce(new Error('Offline'));
  render(<CartPage />); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('加载本次购买失败，请重试');
  expect(orderApi.preview).not.toHaveBeenCalled();
  expect(cartApi.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
  expect(screen.getByRole('button', { name: '结算 (1)' })).toBeEnabled();
  expect(cartApi.add).not.toHaveBeenCalled();
  expect(orderApi.create).not.toHaveBeenCalled();
});

it('confirms an older cart checkout without consuming the newer direct purchase intent', async () => {
  const intent = storedDirectPurchase();
  const original = { items: [{ product_id: 2, quantity: 1 }], shipping_address_id: 41, checkout_key: '22222222-2222-4222-8222-222222222222' };
  sessionStorage.setItem('pending-checkout', JSON.stringify({ sessionKey: JSON.stringify(['buyer-session', 1]), input: original }));
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  const view = render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '重试确认订单' })); await settle();
  expect(orderApi.create).toHaveBeenCalledExactlyOnceWith(original);
  expect(JSON.parse(sessionStorage.getItem('buy-now:buyer-session:1')!)).toEqual(intent);
  view.unmount(); render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '结算 (1)' })); await settle();
  expect(orderApi.create).toHaveBeenLastCalledWith({ items: [intent.input], shipping_address_id: 41, checkout_key: intent.id, checkout_source: 'buy_now', expected_quote: { original_amount: 10, discount_amount: 0, total_amount: 10 } });
  expect(cartApi.add).not.toHaveBeenCalled();
});
