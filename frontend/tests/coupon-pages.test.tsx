import { act, fireEvent, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AdminCouponsPage from '@/app/admin/coupons/page';
import CouponsPage from '@/app/coupons/page';
import MyCouponsPage from '@/app/my/coupons/page';
import { adminCouponApi, couponApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/coupons' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/api', () => ({
  couponApi: { getAvailable: vi.fn(), getMyCoupons: vi.fn(), receive: vi.fn() },
  adminCouponApi: { getList: vi.fn() },
}));

type Coupon = typeof coupon & Record<string, unknown>;
type Response = { data: Coupon[] };

const coupon = {
  coupon_id: 1, user_coupon_id: 7, name: 'Summer', code: 'SUMMER', type: 2, discount_value: 20 as number | string,
  min_amount: 0, total_quantity: 10, remain_quantity: 5, per_user_limit: 1,
  status: 1, coupon_status: 1, received_at: '2026-01-01T00:00:00Z',
  start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z',
};
const customerA = { user_id: 1, username: 'a', email: 'a@example.test' };
const customerB = { user_id: 2, username: 'b', email: 'b@example.test' };
const pages: Record<string, ComponentType> = { coupons: CouponsPage, 'my/coupons': MyCouponsPage, 'admin/coupons': AdminCouponsPage };

async function setup(page: string, coupons: Coupon[] = [coupon]) {
  useAuthStore.getState().login(customerA, 'A');
  localStorage.setItem('admin_token', 'admin-session');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  for (const fn of [couponApi.getAvailable, couponApi.getMyCoupons, adminCouponApi.getList]) vi.mocked(fn).mockResolvedValue({ data: coupons } as never);
  const Page = pages[page];
  const view = render(<Page />);
  await settle();
  return view;
}

describe('my coupons', () => {
  it('opens checkout carrying the exact user coupon ID', async () => {
    await setup('my/coupons');

    fireEvent.click(screen.getByRole('button', { name: '立即使用' }));

    expect(router.push.mock.calls).toEqual([['/cart?user_coupon_id=7']]);
  });

  it.each([
    ['disabled', { coupon_status: 0 }], ['expired', { expired_at: '2020-01-01T00:00:00Z' }],
    ['not yet active', { start_time: '2099-01-01T00:00:00Z' }], ['used', { status: 2 }], ['lapsed', { status: 3 }],
  ])('cannot open checkout with a %s coupon', async (_, changes) => {
    await setup('my/coupons', [{ ...coupon, ...changes }]);

    // Used and lapsed coupons render no use button at all; any button that does render must be disabled.
    const buttons = screen.queryAllByRole('button', { name: /^(立即使用|暂不可用)$/ });
    for (const element of buttons) expect(element).toBeDisabled();
    // A disabled button ignores clicks; its handler must refuse as well.
    for (const element of buttons) await act(() => captureHandler(element)());

    expect(router.push).not.toHaveBeenCalled();
  });

  it("reloads for a new customer and discards the previous customer's response", async () => {
    const first = deferred<Response>();
    let calls = 0;
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getMyCoupons).mockImplementation((() => ++calls === 1 ? first.promise : Promise.resolve({ data: [{ ...coupon, name: 'B的券' }] })) as never);
    render(<MyCouponsPage />);
    await settle();

    act(() => useAuthStore.getState().login(customerB, 'B'));
    await settle();
    expect(calls).toBe(2);
    expect(screen.getByText('B的券')).toBeInTheDocument();

    await act(async () => first.resolve({ data: [{ ...coupon, name: 'A的券' }] }));
    await settle();
    expect(screen.getByText('B的券')).toBeInTheDocument();
    expect(screen.queryByText('A的券')).not.toBeInTheDocument();
  });

  it('ignores the old filter response after a quick status switch', async () => {
    const used = deferred<Response>();
    useAuthStore.getState().login(customerA, 'A');
    vi.mocked(couponApi.getMyCoupons).mockImplementation(((status?: number) => status === 2 ? used.promise
      : Promise.resolve({ data: [{ ...coupon, status, name: status === 3 ? '已过期的券' : '未使用的券' }] })) as never);
    render(<MyCouponsPage />);
    await settle();
    // Keep the expired tab's handler from before the switch, as a quick second tap would use it.
    const expiredTab = captureHandler(screen.getByRole('button', { name: /^已过期/ }));

    fireEvent.click(screen.getByRole('button', { name: /^已使用/ }));
    await act(() => expiredTab());
    await settle();
    expect(screen.getByText('已过期的券')).toBeInTheDocument();

    await act(async () => used.resolve({ data: [{ ...coupon, name: '旧筛选的券' }] }));
    await settle();
    expect(screen.getByText('已过期的券')).toBeInTheDocument();
    expect(screen.queryByText('旧筛选的券')).not.toBeInTheDocument();
  });
});

describe('coupon cards', () => {
  it.each(['coupons', 'my/coupons', 'admin/coupons'])('%s shows a twenty percent reduction as eight tenths payable', async (page) => {
    await setup(page);

    expect(document.body.textContent).toContain('8折');
    expect(document.body.textContent, 'percentages must not display as discount tenths').not.toContain('80折');
  });

  const capCases = ['coupons', 'my/coupons'].flatMap(page => ['0.00', '5.00'].map(cap => ({ page, cap })));

  it.each(capCases)('$page shows a MySQL decimal cap of $cap as ' + 'unlimited only when it is zero', async ({ page, cap }) => {
    await setup(page, [{ ...coupon, discount_value: '20.00', max_discount: cap }]);

    expect(document.body.textContent?.includes('最高优惠')).toBe(cap === '5.00');
    expect(document.body.textContent).toContain('8折');
  });
});

describe('coupon center', () => {
  it("cannot let a late claim for the old customer change the new customer's list", async () => {
    const claim = deferred();
    await setup('coupons');
    vi.mocked(couponApi.receive).mockReturnValue(claim.promise as never);

    fireEvent.click(screen.getByRole('button', { name: /立即领取/ }));
    act(() => useAuthStore.getState().login(customerB, 'B'));
    await settle();
    const before = document.body.innerHTML;

    await act(async () => claim.resolve({}));
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });
});
