import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { addressApi, cartApi, orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  cartApi: { list: vi.fn() },
  addressApi: { list: vi.fn(async () => ({ addresses: [] })) },
  orderApi: { create: vi.fn(), preview: vi.fn(async () => ({ original_amount: 0, discount_amount: 0, total_amount: 0, coupon: null, available_coupons: [] })) },
}));

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const firstItem: CartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'First customer product', price: 10, stock: 5 };
const secondItem: CartItem = { ...firstItem, product_id: 22, title: 'Second customer product' };

const list = vi.mocked(cartApi.list);


it('preserves a deliberate checkout subset after managing addresses', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  list.mockResolvedValue({ items: [firstItem, { ...secondItem, cart_id: 2 }] });
  const first = render(<CartPage />); await settle();
  expect(screen.getByRole('checkbox', { name: '选择 Second customer product' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Second customer product' }));
  await settle();
  expect(screen.getByRole('checkbox', { name: '选择 Second customer product' })).not.toBeChecked();
  expect(vi.mocked(orderApi.preview).mock.calls.at(-1)?.[0].items).toEqual([{ product_id: 12, quantity: 3 }]);
  expect(screen.getByRole('link', { name: '管理收货地址' })).toHaveAttribute('href', '/profile/address');
  window.history.pushState(null, '', '/profile/address'); first.unmount();
  window.history.pushState(null, '', '/cart');
  render(<CartPage />); await settle();
  expect(screen.getByRole('checkbox', { name: '选择 Second customer product' })).not.toBeChecked();
  expect(vi.mocked(orderApi.preview).mock.calls.at(-1)?.[0].items).toEqual([{ product_id: 12, quantity: 3 }]);
});

it('keeps the address link on this page when the deliberate subset cannot be saved', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  list.mockResolvedValue({ items: [firstItem, { ...secondItem, cart_id: 2 }] });
  render(<CartPage />); await settle();
  sessionStorage.setItem('checkout-selection:["first-session",1]', JSON.stringify(['12:base', '22:base']));
  const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Second customer product' })); await settle();
  const cancelled = !screen.getByRole('link', { name: '管理收货地址' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
  expect(cancelled).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('无法保存结算选择，请恢复浏览器存储后重试');
  expect(screen.getByRole('checkbox', { name: '选择 Second customer product' })).not.toBeChecked();
  expect(orderApi.create).not.toHaveBeenCalled();
  act(() => useLocaleStore.setState({ locale: 'en' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to save your checkout selection. Restore browser storage and try again');
  storage.mockRestore();
  act(() => useLocaleStore.setState({ locale: 'zh-CN' }));
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' })); await settle();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem('checkout-selection:["first-session",1]')!)).toEqual(['12:base']);
  expect(orderApi.create).not.toHaveBeenCalled();
});

it('keeps an explicit empty checkout after the address round trip', async () => {
  useAuthStore.getState().login(firstUser, 'first-session'); list.mockResolvedValue({ items: [firstItem] });
  const view = render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('checkbox', { name: '全选' })); await settle();
  vi.mocked(orderApi.preview).mockClear(); view.unmount();
  render(<CartPage />); await settle();
  expect(screen.getByRole('checkbox', { name: '选择 First customer product' })).not.toBeChecked();
  expect(orderApi.preview).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '结算 (0)' })).toBeDisabled();
});

it('intersects restored lines with a fresh cart, retaining SKU identities and requoting', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  const skuItem = { ...firstItem, sku_id: 7, cart_id: 2 };
  list.mockResolvedValueOnce({ items: [firstItem, skuItem, secondItem] }).mockResolvedValueOnce({ items: [skuItem,
    { ...firstItem, available: false, unavailable_reason: '商品已下架' }, { ...secondItem, product_id: 33 }] });
  const view = render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' }));
  vi.mocked(orderApi.preview).mockClear(); view.unmount();
  render(<CartPage />); await settle();
  expect(orderApi.preview).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 12, quantity: 3, sku_id: 7 }] });
  expect(screen.getByRole('status')).toHaveTextContent('已选择 1 / 100 项');
});

it.each(['malformed', 'unavailable'])('does not widen selections when draft storage is %s', async mode => {
  useAuthStore.getState().login(firstUser, 'first-session'); list.mockResolvedValue({ items: [firstItem, secondItem] });
  if (mode === 'malformed') sessionStorage.setItem('checkout-selection:["first-session",1]', '{}');
  else vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  render(<CartPage />); await settle();
  expect(screen.getByRole('checkbox', { name: '选择 First customer product' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '选择 Second customer product' })).not.toBeChecked();
  expect(orderApi.preview).not.toHaveBeenCalled();
  expect(orderApi.create).not.toHaveBeenCalled();
});

it('restores at most 100 explicitly selected lines without selecting fresh additions', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  const rows = Array.from({ length: 101 }, (_, i) => ({ ...firstItem, cart_id: i + 1, product_id: i + 1, title: `Product ${i + 1}` }));
  sessionStorage.setItem('checkout-selection:["first-session",1]', JSON.stringify(rows.slice(0, 100).map(row => `${row.product_id}:base`)));
  list.mockResolvedValue({ items: rows }); render(<CartPage />); await settle();
  expect(vi.mocked(orderApi.preview).mock.lastCall?.[0].items).toHaveLength(100);
  expect(screen.getByRole('checkbox', { name: '选择 Product 101' })).not.toBeChecked();
});

it('does not treat an initially empty cart as a deliberate empty checkout', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  list.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [firstItem] });
  const empty = render(<CartPage />); await settle();
  expect(screen.getByText('购物车是空的')).toBeInTheDocument(); empty.unmount();
  render(<CartPage />); await settle();
  expect(screen.getByRole('checkbox', { name: '选择 First customer product' })).toBeChecked();
  expect(vi.mocked(orderApi.preview).mock.lastCall?.[0].items).toEqual([{ product_id: 12, quantity: 3 }]);
});

it('clears saved choices only after a confirmed checkout', async () => {
  useAuthStore.getState().login(firstUser, 'first-session'); list.mockResolvedValue({ items: [firstItem, secondItem] });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [{ address_id: 41, receiver_name: 'Receiver', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: true }] });
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Second customer product' })); await settle();
  expect(JSON.parse(sessionStorage.getItem('checkout-selection:["first-session",1]')!)).toEqual(['12:base']);
  fireEvent.click(screen.getByRole('button', { name: '结算 (3)' })); await settle();
  expect(orderApi.create).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('checkout-selection:["first-session",1]')).toBeNull();
  expect(router.push).toHaveBeenLastCalledWith('/orders/55');
});


it('retains the chosen receiver after visiting address management and submits only that address', async () => {
  useAuthStore.getState().login(firstUser, 'first-session');
  list.mockResolvedValue({ items: [firstItem] });
  const address = { address_id: 41, receiver_name: 'Default Receiver', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: true };
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [address, { ...address, address_id: 42, receiver_name: 'Chosen Receiver', is_default: false }] });
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  const view = render(<CartPage />); await settle();
  fireEvent.change(screen.getByLabelText('收货地址'), { target: { value: '42' } }); await settle();
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' })); view.unmount();
  render(<CartPage />); await settle();
  expect(screen.getByLabelText('收货地址')).toHaveValue('42');
  expect(addressApi.list).toHaveBeenCalledTimes(2);
  expect(orderApi.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '结算 (3)' })); await settle();
  expect(vi.mocked(orderApi.create).mock.lastCall?.[0].shipping_address_id).toBe(42);
});
