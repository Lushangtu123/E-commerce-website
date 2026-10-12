import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import CartPage from '@/app/cart/page';
import MyCouponsPage from '@/app/my/coupons/page';
import { addressApi, cartApi, couponApi, orderApi, type OrderInput } from '@/lib/api';
import { readCheckoutChoices, storeCheckoutChoices } from '@/lib/checkout-choices';
import { readPendingCheckout, storePendingCheckout } from '@/lib/pending-checkout';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api', () => ({ addressApi: { list: vi.fn() }, cartApi: { list: vi.fn() }, couponApi: { getMyCoupons: vi.fn() },
  orderApi: { preview: vi.fn(), create: vi.fn() } }));

const user = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const sessionKey = JSON.stringify(['buyer-session', 1]);
const directId = '11111111-1111-4111-8111-111111111111';
const first = { address_id: 41, receiver_name: 'Default', phone: '13800138000', province: null, city: null, district: null,
  detail_address: 'Street', is_default: true };
const second = { ...first, address_id: 42, receiver_name: 'Chosen', is_default: false };
const couponA = { user_coupon_id: 7, name: 'Coupon A', code: 'A', discount_amount: 20 };
const couponB = { user_coupon_id: 8, name: 'Coupon B', code: 'B', discount_amount: 30 };
const quote = (input: OrderInput) => {
  const coupon = input.user_coupon_id === 7 ? couponA : input.user_coupon_id === 8 ? couponB : null;
  return { original_amount: 90, discount_amount: coupon?.discount_amount ?? 0, total_amount: 90 - (coupon?.discount_amount ?? 0),
    coupon, available_coupons: [couponA, couponB] };
};
async function setup() {
  useAuthStore.getState().login(user, 'buyer-session');
  vi.mocked(cartApi.list).mockResolvedValue({ items: [{ cart_id: 1, product_id: 12, title: 'Product', quantity: 3, price: 30, stock: 5 }] });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [first, second] });
  vi.mocked(orderApi.preview).mockImplementation(async input => quote(input));
  vi.mocked(couponApi.getMyCoupons).mockResolvedValue({ data: [{ ...couponB, coupon_id: 2, user_id: 1, type: 3,
    discount_value: 30, min_amount: 0, status: 1, coupon_status: 1,
    received_at: '2026-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z' }],
    pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } });
}
async function select(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); await settle(); }
async function openMyCoupons() { window.history.pushState(null, '', '/my/coupons'); const view = render(<MyCouponsPage />); await settle(); return view; }
async function useCouponAndReturn(view: ReturnType<typeof render>) {
  fireEvent.click(screen.getByRole('button', { name: '立即使用' })); await settle();
  expect(router.push).toHaveBeenLastCalledWith('/cart?user_coupon_id=8');
  view.unmount(); window.history.pushState(null, '', router.push.mock.calls.at(-1)![0]);
  const cart = render(<CartPage />); await settle(); return cart;
}

it.each(['', '7'])('a fresh use action replaces saved coupon %s, retaining the chosen address and requiring a fresh quote', async oldCoupon => {
  await setup(); const cart = render(<CartPage />); await settle();
  await select('收货地址', '42'); await select('优惠券', oldCoupon); cart.unmount();
  const coupons = await openMyCoupons();
  const fresh = deferred<ReturnType<typeof quote>>();
  vi.mocked(orderApi.preview).mockReturnValue(fresh.promise); vi.mocked(orderApi.preview).mockClear();
  await useCouponAndReturn(coupons);
  expect(screen.getByLabelText('收货地址')).toHaveValue('42');
  expect(orderApi.preview).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 8 });
  expect(screen.getByRole('button', { name: '结算 (3)' })).toBeDisabled();
  expect(orderApi.create).not.toHaveBeenCalled();
  await act(() => fresh.resolve(quote({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 8 }))); await settle();
  expect(screen.getByLabelText('优惠券')).toHaveValue('8');
  expect(screen.getByText('应付金额').parentElement).toHaveTextContent('¥60.00');
  expect(screen.getByRole('button', { name: '结算 (3)' })).toBeEnabled();
});

it.each(['throw', 'unacknowledged'])('does not navigate after a %s choice write, preserves old choices and retries safely', async failure => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: null });
  await openMyCoupons();
  const original = sessionStorage.setItem.bind(sessionStorage);
  const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
    if (key.startsWith('checkout-choices:')) { if (failure === 'throw') throw new Error('quota'); return; }
    original(key, value);
  });
  fireEvent.click(screen.getByRole('button', { name: '立即使用' })); await settle();
  expect(router.push).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenLastCalledWith('无法保存结算选择，请恢复浏览器存储后重试');
  expect(readCheckoutChoices(sessionKey, null)).toEqual({ addressId: 42, couponId: null });
  act(() => useLocaleStore.getState().setLocale('en'));
  fireEvent.click(screen.getByRole('button', { name: 'Use now' })); await settle();
  expect(toast.error).toHaveBeenLastCalledWith('Unable to save your checkout selection. Restore browser storage and try again');
  storage.mockRestore(); fireEvent.click(screen.getByRole('button', { name: 'Use now' })); await settle();
  expect(router.push).toHaveBeenCalledExactlyOnceWith('/cart?user_coupon_id=8');
  expect(readCheckoutChoices(sessionKey, null)).toEqual({ addressId: 42, couponId: 8 });
});

it.each(['throw', 'mismatch'])('restores the previous receiver and coupon after the write succeeds but acknowledgement reads %s', async failure => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: 7 });
  const view = await openMyCoupons();
  const originalWrite = sessionStorage.setItem.bind(sessionStorage);
  const originalRead = sessionStorage.getItem.bind(sessionStorage);
  let wroteNewChoice = false, failAcknowledgement = false;
  const write = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key, value) => {
    originalWrite(key, value);
    if (!wroteNewChoice && key.startsWith('checkout-choices:')) { wroteNewChoice = true; failAcknowledgement = true; }
  });
  const read = vi.spyOn(sessionStorage, 'getItem').mockImplementation(key => {
    if (failAcknowledgement && key.startsWith('checkout-choices:')) {
      failAcknowledgement = false;
      if (failure === 'throw') throw new Error('read failed');
      return '{"couponId":99}';
    }
    return originalRead(key);
  });
  fireEvent.click(screen.getByRole('button', { name: '立即使用' })); await settle();
  expect(wroteNewChoice).toBe(true);
  expect(router.push).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenLastCalledWith('无法保存结算选择，请恢复浏览器存储后重试');
  expect(readCheckoutChoices(sessionKey, null)).toEqual({ addressId: 42, couponId: 7 });
  write.mockRestore(); read.mockRestore();
  await useCouponAndReturn(view);
  expect(readCheckoutChoices(sessionKey, null)).toEqual({ addressId: 42, couponId: 8 });
  expect(screen.getByLabelText('收货地址')).toHaveValue('42');
  expect(screen.getByLabelText('优惠券')).toHaveValue('8');
  expect(screen.getByText('应付金额').parentElement).toHaveTextContent('¥60.00');
  expect(orderApi.create).not.toHaveBeenCalled();
});

it('does not replace a corrupt address draft with an implicit default address', async () => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: null });
  const key = Object.keys(sessionStorage).find(value => value.startsWith('checkout-choices:'))!;
  const corrupt = '{"addressId":"wrong","couponId":null}'; sessionStorage.setItem(key, corrupt);
  await openMyCoupons(); fireEvent.click(screen.getByRole('button', { name: '立即使用' })); await settle();
  expect(router.push).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(corrupt);
  expect(toast.error).toHaveBeenLastCalledWith('无法读取结算选择，请重新选择收货地址和优惠券');
});

it('keeps the direct purchase and other-session drafts unchanged and ignores a departed session handler', async () => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: null });
  storeCheckoutChoices(sessionKey, directId, { addressId: 41, couponId: 7 });
  const otherSession = JSON.stringify(['other-session', 2]); storeCheckoutChoices(otherSession, null, { addressId: 99, couponId: null });
  const view = await openMyCoupons(); const oldUse = captureHandler(screen.getByRole('button', { name: '立即使用' }));
  await useCouponAndReturn(view);
  expect(readCheckoutChoices(sessionKey, directId)).toEqual({ addressId: 41, couponId: 7 });
  expect(readCheckoutChoices(otherSession, null)).toEqual({ addressId: 99, couponId: null });
  const calls = router.push.mock.calls.length;
  act(() => useAuthStore.getState().login({ ...user, user_id: 2 }, 'other-session'));
  await oldUse(); await settle();
  expect(router.push.mock.calls).toHaveLength(calls);
  expect(readCheckoutChoices(otherSession, null)).toEqual({ addressId: 99, couponId: null });
});

it('preserves the original pending checkout and only retries its original coupon on an explicit confirmation', async () => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: 7 });
  const input = { items: [{ product_id: 12, quantity: 3 }], shipping_address_id: 42, user_coupon_id: 7, checkout_key: directId,
    expected_quote: { original_amount: 90, discount_amount: 20, total_amount: 70 } };
  storePendingCheckout({ sessionKey, input });
  const view = await openMyCoupons(); await useCouponAndReturn(view);
  expect(readCheckoutChoices(sessionKey, null)).toEqual({ addressId: 42, couponId: 8 });
  expect(readPendingCheckout(sessionKey)).toEqual({ sessionKey, input });
  expect(orderApi.create).not.toHaveBeenCalled();
  vi.mocked(orderApi.create).mockRejectedValueOnce(new Error('Lost response'));
  fireEvent.click(screen.getByRole('button', { name: '重试确认订单' })); await settle();
  expect(orderApi.create).toHaveBeenCalledExactlyOnceWith(input);
  expect(readPendingCheckout(sessionKey)).toEqual({ sessionKey, input });
});

it('revalidates the explicitly requested coupon when it became unavailable after the coupon list was read', async () => {
  await setup(); storeCheckoutChoices(sessionKey, null, { addressId: 42, couponId: null });
  const view = await openMyCoupons();
  vi.mocked(orderApi.preview).mockImplementation(async input => {
    if (input.user_coupon_id === 8) throw apiError('优惠券已过期');
    return { ...quote(input), available_coupons: [couponA] };
  });
  await useCouponAndReturn(view);
  expect(orderApi.preview).toHaveBeenCalledWith({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 8 });
  expect(screen.getByRole('alert')).toHaveTextContent('所选优惠券当前不可用');
  expect(screen.getByLabelText('优惠券')).toHaveValue(''); expect(orderApi.create).not.toHaveBeenCalled();
});
