import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { addressApi, cartApi, orderApi, productApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';

// The cart page's effects must fire on session, cart or choice changes, not on unrelated re-renders.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ cartApi: { list: vi.fn() }, productApi: { getDetail: vi.fn() }, addressApi: { list: vi.fn() }, orderApi: { create: vi.fn(), preview: vi.fn() } }));
const address = { address_id: 41, receiver_name: 'Default', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: true };
const item = { cart_id: 1, product_id: 12, title: 'Product', quantity: 3, price: 30, stock: 5 };
const purchaseId = '11111111-1111-4111-8111-111111111111';

function mockApis() {
  vi.mocked(cartApi.list).mockResolvedValue({ items: [item] });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [address] });
  vi.mocked(orderApi.preview).mockResolvedValue({ original_amount: 90, discount_amount: 0, total_amount: 90, coupon: null, available_coupons: [] });
  vi.mocked(productApi.getDetail).mockResolvedValue({ product: { product_id: 12, title: 'Product', price: 30, stock: 5, status: 1, sales_count: 0, rating: 0 } });
}
const calls = () => [cartApi.list, addressApi.list, orderApi.preview, productApi.getDetail].map(fn => vi.mocked(fn).mock.calls.length);

it.each([null, purchaseId])('unrelated re-renders do not repeat requests (buy now %s)', async purchase => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'session-one');
  mockApis();
  if (purchase) {
    sessionStorage.setItem('buy-now:session-one:1', JSON.stringify({ id: purchase, ready: true, source: 'buy_now', input: { product_id: 12, quantity: 3 } }));
    window.history.replaceState(null, '', `/cart?buy_now=${purchase}`);
  }
  const view = render(<CartPage />); await settle();
  const settled = calls();
  expect(settled[2]).toBe(1);

  act(() => useLocaleStore.setState({ locale: 'en' })); await settle();
  act(() => useLocaleStore.setState({ locale: 'zh-CN' })); await settle();
  view.rerender(<CartPage />); await settle();
  expect(calls()).toEqual(settled);
});

it('a session switch reloads the cart, addresses and quote for the new customer', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'session-one');
  mockApis();
  render(<CartPage />); await settle();
  const [cart, addresses, preview] = calls();

  act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'session-two')); await settle();
  const after = calls();
  expect(after[0]).toBeGreaterThan(cart);
  expect(after[1]).toBe(addresses + 1);
  expect(after[2]).toBe(preview + 1);
});
