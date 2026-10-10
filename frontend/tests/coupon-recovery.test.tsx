import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CouponsPage from '@/app/coupons/page';
import MyCouponsPage from '@/app/my/coupons/page';
import { couponApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { apiError, captureHandler, clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/coupons' }));
vi.mock('react-hot-toast', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ couponApi: { getAvailable: vi.fn(), getMyCoupons: vi.fn(), receive: vi.fn() } }));

const customerA = { user_id: 1, username: 'a', email: 'a@example.test' };
const customerB = { user_id: 2, username: 'b', email: 'b@example.test' };
const coupon = {
  coupon_id: 1, user_coupon_id: 7, user_id: 1, name: 'Summer', code: 'SUMMER', description: '',
  type: 2, discount_value: 20, min_amount: 0, max_discount: null, total_quantity: 10, remain_quantity: 5, per_user_limit: 1,
  status: 1, coupon_status: 1, received_at: '2026-01-01T00:00:00Z',
  start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z',
};
type Coupon = typeof coupon;
const centerResponse = (data: Coupon[], total = data.length, page = 1) => ({
  success: true, data, pagination: { page, page_size: 50, total, total_pages: Math.ceil(total / 50) },
});
const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...coupon, coupon_id: index + 1, name: `优惠券${index + 1}` }));
const cases = [
  { name: 'coupon center', Page: CouponsPage, load: couponApi.getAvailable, empty: '暂无可领取的优惠券' },
  { name: 'my coupons', Page: MyCouponsPage, load: couponApi.getMyCoupons, empty: '暂无未使用的优惠券' },
];

describe.each(cases)('$name recovery', ({ Page, load, empty }) => {
  it('shows the empty state only after a successful empty response', async () => {
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(load).mockResolvedValue(centerResponse([]) as never);
    render(<Page />); await settle();
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a failed request visible and retries until data is loaded', async () => {
    const recovery = deferred();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(load).mockRejectedValueOnce(apiError('服务暂不可用', 'message')).mockReturnValueOnce(recovery.promise as never);
    render(<Page />); await settle();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('服务暂不可用');

    const retry = screen.getByRole('button', { name: '重新加载优惠券' });
    clickTogether(retry, retry);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    await act(async () => recovery.resolve(centerResponse([coupon]))); await settle();
    expect(screen.getByText(coupon.name)).toBeInTheDocument();
  });

  it('drops a pending retry when another account signs in', async () => {
    const recovery = deferred();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(load).mockRejectedValueOnce(apiError('服务暂不可用', 'message'))
      .mockReturnValueOnce(recovery.promise as never).mockResolvedValue(centerResponse([{ ...coupon, name: 'B的券' }]) as never);
    render(<Page />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载优惠券' })); await settle();
    act(() => useAuthStore.getState().login(customerB, 'B')); await settle();
    expect(screen.getByText('B的券')).toBeInTheDocument();
    await act(async () => recovery.resolve(centerResponse([{ ...coupon, name: 'A的券' }]))); await settle();
    expect(screen.queryByText('A的券')).not.toBeInTheDocument();
    expect(screen.getByText('B的券')).toBeInTheDocument();
  });
});

describe('coupon center pagination and claims', () => {
  it('loads the older coupon on page two and retains that page when a load needs retry', async () => {
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getAvailable).mockResolvedValueOnce(centerResponse(firstPage, 51))
      .mockRejectedValueOnce(apiError('服务暂不可用', 'message'))
      .mockResolvedValueOnce(centerResponse([{ ...coupon, coupon_id: 51, name: '较早的优惠券' }], 51, 2));
    render(<CouponsPage />); await settle();
    expect(screen.getByText('共 51 张优惠券')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('服务暂不可用');
    expect(screen.queryByText('优惠券1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载优惠券' })); await settle();
    expect(couponApi.getAvailable).toHaveBeenLastCalledWith(2, 50);
    expect(screen.getByText('较早的优惠券')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('returns to the new last page after claiming the final available coupon', async () => {
    useAuthStore.getState().login(customerA, 'A');
    let exhausted = false;
    vi.mocked(couponApi.getAvailable).mockImplementation(((page: number) => Promise.resolve(
      page === 1 ? centerResponse(firstPage, exhausted ? 50 : 51) : centerResponse(exhausted ? [] : [{ ...coupon, name: '最后一张', remain_quantity: 1 }], exhausted ? 50 : 51, 2)
    )) as never);
    vi.mocked(couponApi.receive).mockImplementation(async () => { exhausted = true; return { success: true, data: { user_coupon_id: 7 } } as never; });
    render(<CouponsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    fireEvent.click(screen.getByRole('button', { name: '立即领取' })); await settle(10);
    expect(couponApi.getAvailable).toHaveBeenLastCalledWith(1, 50);
    expect(screen.getByText('优惠券1')).toBeInTheDocument();
    expect(screen.getByText('共 50 张优惠券')).toBeInTheDocument();
    expect(screen.queryByText('暂无可领取的优惠券')).not.toBeInTheDocument();
  });

  it('starts a new account on page one and ignores the old page response', async () => {
    const secondPage = deferred();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getAvailable).mockResolvedValueOnce(centerResponse(firstPage, 51))
      .mockReturnValueOnce(secondPage.promise as never).mockResolvedValueOnce(centerResponse([{ ...coupon, name: 'B的券' }]));
    render(<CouponsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    act(() => useAuthStore.getState().login(customerB, 'B')); await settle();
    expect(couponApi.getAvailable).toHaveBeenLastCalledWith(1, 50);
    expect(screen.getByText('B的券')).toBeInTheDocument();
    await act(async () => secondPage.resolve(centerResponse([{ ...coupon, name: 'A的旧页面' }], 51, 2))); await settle();
    expect(screen.queryByText('A的旧页面')).not.toBeInTheDocument();
  });

  it('locks a coupon claim before two rapid clicks can send duplicate writes', async () => {
    const claim = deferred();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(centerResponse([coupon]));
    vi.mocked(couponApi.receive).mockReturnValue(claim.promise as never);
    render(<CouponsPage />); await settle();
    const button = screen.getByRole('button', { name: '立即领取' });
    clickTogether(button, button);
    expect(couponApi.receive).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => claim.resolve({ success: true, data: { user_coupon_id: 7 } })); await settle();
  });

  it('refuses a displayed claim after another tab changes stored session', async () => {
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(centerResponse([coupon]));
    render(<CouponsPage />); await settle();
    const claim = captureHandler(screen.getByRole('button', { name: '立即领取' }));
    localStorage.setItem('session', 'B');
    await claim();
    expect(couponApi.receive).not.toHaveBeenCalled();
  });
});

describe('my coupons filter recovery', () => {
  it('ignores a retry error after switching to another status', async () => {
    const recovery = deferred();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getMyCoupons).mockRejectedValueOnce(apiError('服务暂不可用', 'message'))
      .mockReturnValueOnce(recovery.promise as never).mockResolvedValueOnce({ data: [{ ...coupon, status: 2, name: '已使用的券' }] });
    render(<MyCouponsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载优惠券' })); await settle();
    fireEvent.click(screen.getByRole('button', { name: '已使用' })); await settle();
    expect(screen.getByText('已使用的券')).toBeInTheDocument();
    await act(async () => recovery.reject(apiError('旧请求失败', 'message'))); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('已使用的券')).toBeInTheDocument();
  });
});
