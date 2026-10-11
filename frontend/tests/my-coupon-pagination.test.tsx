import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MyCouponsPage from '@/app/my/coupons/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { captureHandler, deferred, render, settle } from './helpers';
import { useLocaleStore } from '@/store/useLocaleStore';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/my/coupons' }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const coupon = (id: number, status = 1) => ({ coupon_id: id, user_coupon_id: id, user_id: 1, code: `C${id}`, name: `Coupon ${id}`, type: 3,
  discount_value: '1.00', min_amount: '0.00', max_discount: null, status, coupon_status: 1,
  received_at: '2026-10-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z', start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z' });

it('shows twenty owned coupons per page and carries the exact selected receipt to checkout', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'my-coupon-pages');
  const rows = Array.from({ length: 21 }, (_, i) => coupon(i + 1));
  const requests: unknown[] = [];
  api.defaults.adapter = async config => {
    requests.push(config.params);
    const page = config.params?.page ?? 1;
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true,
      data: config.params?.page ? rows.slice((page - 1) * 20, page * 20) : rows,
      pagination: { page, page_size: 20, total: 21, total_pages: 2 } } };
  };
  render(<MyCouponsPage />); await settle();
  expect(screen.getAllByRole('button', { name: '立即使用' })).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
  expect(screen.getByText('Coupon 21')).toBeInTheDocument();
  expect(screen.queryByText('Coupon 1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '立即使用' }));
  expect(router.push).toHaveBeenCalledWith('/cart?user_coupon_id=21');
  expect(requests).toEqual([{ status: 1, page: 1, page_size: 20 }, { status: 1, page: 2, page_size: 20 }]);
});

const response = (data: ReturnType<typeof coupon>[], page = 1, total = data.length) => ({ success: true, data,
  pagination: { page, page_size: 20, total, total_pages: Math.ceil(total / 20) } });
it('used coupons keep malformed used_at out of date formatting and recover via GET', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'my-coupon-pages');
  let usedReads = 0;
  const methods: string[] = [];
  api.defaults.adapter = async config => {
    methods.push(config.method!);
    const data = config.params.status === 2 ? { ...response([]), data: [{ ...coupon(1, 2), used_at: ++usedReads === 1
      ? { toString: null, valueOf: null } : '2026-10-01T00:00:00Z' }], pagination: response([coupon(1)]).pagination } : response([]);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  render(<MyCouponsPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '已使用' })); await settle();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载优惠券' })); await settle();
  expect(screen.getByText('Coupon 1')).toBeInTheDocument();
  expect(methods).toEqual(['get', 'get', 'get']);
});
const invalid: unknown[] = [null, {}, { ...response([]), success: false },
  { data: [] }, { data: {}, pagination: response([]).pagination },
  ...[{ page: 2 }, { page_size: 50 }, { total: null }, { total: true }, { total: -1 }, { total_pages: 9 }]
    .map(change => ({ ...response([]), pagination: { ...response([]).pagination, ...change } })),
  ...[{ ...coupon(1), user_id: 2 }, { ...coupon(1), user_coupon_id: 0 }, { ...coupon(1), status: 2 },
    { ...coupon(1), discount_value: true }, { ...coupon(1), received_at: 'invalid' }, { ...coupon(1), name: {} }]
    .map(row => ({ ...response([]), data: [row] })),
  response([coupon(1), coupon(1)]),
];
it.each(invalid.map((value, index) => ({ value, index })))('keeps malformed coupon page $index retryable in both languages', async ({ value }) => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'my-coupon-pages');
  const methods: string[] = [];
  api.defaults.adapter = async config => {
    methods.push(config.method!);
    return { config, status: 200, statusText: 'OK', headers: {}, data: methods.length === 1 ? value : response([coupon(1)]) };
  };
  render(<MyCouponsPage />); await settle();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('暂无未使用的优惠券')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '立即使用' })).not.toBeInTheDocument();
  act(() => useLocaleStore.getState().setLocale('en'));
  fireEvent.click(screen.getByRole('button', { name: 'Reload coupons' })); await settle();
  expect(screen.getByText('Coupon 1')).toBeInTheDocument();
  expect(methods).toEqual(['get', 'get']);
});

it('resets filters and account pagination while ignoring old rows and saved use handlers', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'my-coupon-pages');
  const delayed = deferred<unknown>();
  const requests: { status: number; page: number; page_size: number }[] = [];
  api.defaults.adapter = async config => {
    const params = config.params; requests.push(params);
    const userId = useAuthStore.getState().user!.user_id;
    const data = params.status === 1 && params.page === 2 ? await delayed.promise
      : response([{ ...coupon(userId === 2 ? 99 : 1, params.status), user_id: userId }], params.page, userId === 1 && params.status === 1 ? 21 : 1);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  render(<MyCouponsPage />); await settle();
  const oldUse = captureHandler(screen.getByRole('button', { name: '立即使用' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: '已使用' })); await settle();
  expect(requests.at(-1)).toEqual({ status: 2, page: 1, page_size: 20 });
  await oldUse(); expect(router.push).not.toHaveBeenCalled();
  act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'other-session')); await settle();
  expect(requests.at(-1)).toEqual({ status: 1, page: 1, page_size: 20 });
  await act(async () => delayed.resolve(response([coupon(21)], 2, 21))); await settle();
  expect(screen.getByText('Coupon 99')).toBeInTheDocument();
  expect(screen.queryByText('Coupon 21')).not.toBeInTheDocument();
  expect(router.push).not.toHaveBeenCalled();
});

it('returns to the new last page when expiry removes the only row on page two', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'my-coupon-pages');
  const pages: number[] = [];
  api.defaults.adapter = async config => {
    const page = config.params.page; pages.push(page);
    return { config, status: 200, statusText: 'OK', headers: {}, data: page === 2 ? response([], 2, 20)
      : response(Array.from({ length: 20 }, (_, i) => coupon(i + 1)), 1, pages.length === 1 ? 21 : 20) };
  };
  render(<MyCouponsPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle(10);
  expect(pages).toEqual([1, 2, 1]);
  expect(screen.getAllByRole('button', { name: '立即使用' })).toHaveLength(20);
  expect(screen.queryByText('暂无未使用的优惠券')).not.toBeInTheDocument();
});
