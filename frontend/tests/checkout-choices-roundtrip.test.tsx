import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import AddressPage from '@/app/profile/address/page';
import { addressApi, cartApi, orderApi, productApi, type OrderInput } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ cartApi: { list: vi.fn() }, productApi: { getDetail: vi.fn() }, addressApi: { list: vi.fn() }, orderApi: { create: vi.fn(), preview: vi.fn() } }));
const user = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const first = { address_id: 41, receiver_name: 'Default', phone: '13800138000', province: null, city: null, district: null, detail_address: 'Street', is_default: true };
const second = { ...first, address_id: 42, receiver_name: 'Chosen', is_default: false };
const item = { cart_id: 1, product_id: 12, title: 'Product', quantity: 3, price: 30, stock: 5 };
const coupon = { user_coupon_id: 7, name: 'Summer', code: 'SUMMER', discount_amount: 20 };
const quote = (input: OrderInput) => ({ original_amount: 90, discount_amount: input.user_coupon_id === 7 ? 20 : 0,
  total_amount: input.user_coupon_id === 7 ? 70 : 90, coupon: input.user_coupon_id === 7 ? coupon : null, available_coupons: [coupon] });
async function setup(purchaseId: string | null = null) {
  useAuthStore.getState().login(user, 'buyer-session');
  vi.mocked(cartApi.list).mockResolvedValue({ items: [item] });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [first, second] });
  vi.mocked(orderApi.preview).mockImplementation(async input => quote(input));
  vi.mocked(productApi.getDetail).mockResolvedValue({ product: { product_id: 12, title: 'Product', price: 30, stock: 5, status: 1, sales_count: 0, rating: 0 } });
  if (purchaseId) {
    sessionStorage.setItem('buy-now:buyer-session:1', JSON.stringify({ id: purchaseId, ready: true, source: 'buy_now', input: { product_id: 12, quantity: 3 } }));
    window.history.replaceState(null, '', `/cart?buy_now=${purchaseId}`);
  }
  const view = render(<CartPage />); await settle(); return view;
}
async function choose(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); await settle(); }
async function roundtrip(view: ReturnType<typeof render>) {
  const link = screen.getByRole('link', { name: '管理收货地址' });
  const href = link.getAttribute('href')!;
  fireEvent.click(link); view.unmount(); window.history.pushState(null, '', href);
  const management = render(<AddressPage />); await settle();
  const back = screen.getByRole('link', { name: '返回购物车' }).getAttribute('href')!;
  management.unmount(); window.history.pushState(null, '', back);
  const returned = render(<CartPage />); await settle(); return returned;
}
const checkout = () => screen.getByRole('button', { name: '结算 (3)' });

it.each([null, '11111111-1111-4111-8111-111111111111'])('retains address and coupon through actual address management in purchase %s', async purchaseId => {
  const view = await setup(purchaseId);
  await choose('收货地址', '42'); await choose('优惠券', '7');
  expect(screen.getByText('¥70.00')).toBeInTheDocument();
  vi.mocked(orderApi.preview).mockClear();
  await roundtrip(view);
  expect(screen.getByLabelText('收货地址')).toHaveValue('42');
  expect(screen.getByLabelText('优惠券')).toHaveValue('7');
  expect(orderApi.preview).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 });
  expect(screen.getByText('¥70.00')).toBeInTheDocument();
  expect(checkout()).toBeEnabled(); expect(orderApi.create).not.toHaveBeenCalled();
});

it('preserves an explicit no-coupon choice even if the coupon URL remains after reload', async () => {
  const view = await setup();
  window.history.replaceState(null, '', '/cart?user_coupon_id=7');
  await choose('优惠券', '7'); await choose('优惠券', '');
  view.unmount(); vi.mocked(orderApi.preview).mockClear();
  render(<CartPage />); await settle();
  expect(screen.getByLabelText('优惠券')).toHaveValue('');
  expect(orderApi.preview).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 12, quantity: 3 }] });
  expect(screen.getByText('应付金额').parentElement).toHaveTextContent('¥90.00');
});

it('requires another explicit address after the chosen address disappears instead of using the default', async () => {
  const view = await setup(); await choose('收货地址', '42');
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' })); view.unmount();
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [first] });
  render(<CartPage />); await settle();
  expect(screen.getByLabelText('收货地址')).toHaveValue('');
  expect(screen.getByRole('alert')).toHaveTextContent('原收货地址已不可用');
  expect(checkout()).toBeDisabled(); fireEvent.click(checkout()); expect(orderApi.create).not.toHaveBeenCalled();
  act(() => useLocaleStore.setState({ locale: 'en' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Your previous shipping address is unavailable');
  act(() => useLocaleStore.setState({ locale: 'zh-CN' }));
  await choose('收货地址', '41'); expect(checkout()).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('revalidates a restored coupon, reports expiry and obtains a fresh quote without placing an order', async () => {
  const view = await setup(); await choose('优惠券', '7');
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' })); view.unmount();
  vi.mocked(orderApi.preview).mockImplementation(async input => {
    if (input.user_coupon_id === 7) throw apiError('优惠券已过期');
    return { ...quote(input), available_coupons: [] };
  });
  render(<CartPage />); await settle();
  expect(screen.getByLabelText('优惠券')).toHaveValue('');
  expect(screen.getByRole('alert')).toHaveTextContent('所选优惠券当前不可用');
  expect(screen.getByText('应付金额').parentElement).toHaveTextContent('¥90.00'); expect(orderApi.create).not.toHaveBeenCalled();
  act(() => useLocaleStore.setState({ locale: 'en' }));
  expect(screen.getByRole('alert')).toHaveTextContent('selected coupon is unavailable');
});

it('blocks navigation in direct purchase when choices cannot be saved and retries after storage recovers', async () => {
  await setup('11111111-1111-4111-8111-111111111111'); await choose('收货地址', '42'); await choose('优惠券', '7');
  const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const cancelled = !screen.getByRole('link', { name: '管理收货地址' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle(); expect(cancelled).toBe(true); expect(screen.getByRole('alert')).toHaveTextContent('无法保存结算选择');
  expect(orderApi.create).not.toHaveBeenCalled(); storage.mockRestore();
  fireEvent.click(screen.getByRole('link', { name: '管理收货地址' })); await settle();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps ordinary cart choices separate from a new direct purchase and from another customer', async () => {
  const view = await setup(); await choose('收货地址', '42'); await choose('优惠券', '7'); view.unmount();
  const direct = await setup('11111111-1111-4111-8111-111111111111');
  expect(screen.getByLabelText('收货地址')).toHaveValue('41'); expect(screen.getByLabelText('优惠券')).toHaveValue(''); direct.unmount();
  window.history.replaceState(null, '', '/cart'); render(<CartPage />); await settle();
  expect(screen.getByLabelText('收货地址')).toHaveValue('42'); expect(screen.getByLabelText('优惠券')).toHaveValue('7');
  act(() => useAuthStore.getState().login({ ...user, user_id: 2 }, 'second-session')); await settle();
  expect(screen.getByLabelText('收货地址')).toHaveValue('41'); expect(screen.getByLabelText('优惠券')).toHaveValue('');
});

it('cannot enable checkout with the old address before its fresh ownership read finishes', async () => {
  const view = await setup(); await choose('收货地址', '42'); view.unmount();
  const read = deferred<{ addresses: typeof first[] }>(); vi.mocked(addressApi.list).mockReturnValue(read.promise);
  render(<CartPage />); await settle(); expect(checkout()).toBeDisabled(); expect(screen.queryByLabelText('收货地址')).not.toBeInTheDocument();
  await act(() => read.resolve({ addresses: [first] })); await settle(); expect(checkout()).toBeDisabled();
  expect(screen.getByLabelText('收货地址')).toHaveValue(''); expect(orderApi.create).not.toHaveBeenCalled();
});


it('clears choice identifiers only after the order receipt is confirmed', async () => {
  await setup(); await choose('收货地址', '42'); await choose('优惠券', '7');
  // Resolve the key from the per-tab inventory so quoting does not hide the outcome.
  const stored = Object.keys(sessionStorage).find(value => value.startsWith('checkout-choices:'))!;
  expect(stored).toBeTruthy();
  vi.mocked(orderApi.create).mockRejectedValueOnce(new Error('lost receipt'));
  fireEvent.click(checkout()); await settle();
  expect(JSON.parse(sessionStorage.getItem(stored)!)).toEqual({ addressId: 42, couponId: 7 });
  vi.mocked(orderApi.create).mockResolvedValueOnce({ order_id: 55, message: '订单创建成功' });
  fireEvent.click(screen.getByRole('button', { name: '重试确认订单' })); await settle();
  expect(sessionStorage.getItem(stored)).toBeNull();
  expect(router.push).toHaveBeenLastCalledWith('/orders/55');
});


it('lets a customer with a corrupt draft and no addresses reach management, then requires an explicit new address', async () => {
  const view = await setup(); await choose('收货地址', '42'); view.unmount();
  const stored = Object.keys(sessionStorage).find(value => value.startsWith('checkout-choices:'))!;
  sessionStorage.setItem(stored, '{"addressId":"wrong"}');
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [] });
  const corrupted = render(<CartPage />); await settle(); expect(checkout()).toBeDisabled();
  expect(screen.getByText('请先添加收货地址')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: '管理收货地址' });
  expect(link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true);
  await settle(); expect(JSON.parse(sessionStorage.getItem(stored)!)).toEqual({ addressId: null, couponId: null });
  // A newly added owned address must not silently resolve the previous corrupt choice.
  corrupted.unmount();
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [first] });
  render(<CartPage />); await settle();
  expect(screen.getByLabelText('收货地址')).toHaveValue(''); expect(checkout()).toBeDisabled();
  await choose('收货地址', '41'); expect(checkout()).toBeEnabled();
  expect(JSON.parse(sessionStorage.getItem(stored)!)).toEqual({ addressId: 41, couponId: null });
});
