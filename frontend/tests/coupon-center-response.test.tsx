import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CouponsPage from '@/app/coupons/page';
import { couponApi } from '@/lib/api';
import { translate } from '@/lib/i18n';
import { prepareCouponClaim, readPendingCouponClaim } from '@/lib/pending-coupon-claim';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ couponApi: { getAvailable: vi.fn(), receive: vi.fn() } }));

const customer = { user_id: 1, username: 'Fixture', email: 'fixture@example.test' };
const coupon = {
  coupon_id: 1, code: 'SUMMER', name: 'Summer', type: 2, discount_value: '20.00', min_amount: '0.00',
  total_quantity: 10, remain_quantity: 5, per_user_limit: 1, status: 1,
  start_time: '2020-01-01T00:00:00.000Z', end_time: '2099-01-01T00:00:00.000Z',
};
const response = (data: unknown[] = [coupon], total = data.length, page = 1) => ({
  success: true, data, pagination: { page, page_size: 50, total, total_pages: Math.ceil(total / 50) },
});
const invalidResponses: [string, unknown][] = [
  ['missing envelope', {}], ['missing success', { ...response(), success: undefined }],
  ['false success', { ...response(), success: false }], ['string success', { ...response(), success: 'true' }],
  ['missing rows', { ...response(), data: undefined }], ['null rows', { ...response(), data: null }],
  ['object rows', { ...response(), data: {} }], ['null row', response([null])], ['array row', response([[]])],
  ['missing pagination', { ...response(), pagination: undefined }],
  ...[
    { page: 2 }, { page: '1' }, { page_size: 20 }, { page_size: '50' }, { total: -1 },
    { total: 1.5 }, { total: '1' }, { total: Infinity }, { total: Number.MAX_SAFE_INTEGER + 1 },
    { total_pages: '1' }, { total_pages: -1 }, { total_pages: 2 },
  ].map<[string, unknown]>(changes => [`invalid pagination ${JSON.stringify(changes)}`, { ...response(), pagination: { ...response().pagination, ...changes } }]),
  ['oversized page', response(Array.from({ length: 51 }, (_, index) => ({ ...coupon, coupon_id: index + 1 })))],
  ['duplicate IDs', response([coupon, coupon])],
  ...[
    { coupon_id: '1' }, { coupon_id: 0 }, { coupon_id: 1.5 }, { coupon_id: 2147483648 },
    { code: '' }, { name: '' }, { description: { text: 'Invalid' } }, { type: 0 }, { type: '2' }, { status: 0 }, { status: '1' },
    { discount_value: '20x' }, { discount_value: '0.001' }, { discount_value: -1 },
    { discount_value: 0 }, { discount_value: '100.01' }, { min_amount: null }, { min_amount: 'NaN' },
    { max_discount: -1 }, { total_quantity: 0 }, { total_quantity: '10' }, { total_quantity: 2147483648 },
    { remain_quantity: -1 }, { remain_quantity: 1.5 }, { remain_quantity: '5' }, { remain_quantity: 11 },
    { per_user_limit: 0 }, { per_user_limit: 1.5 }, { per_user_limit: '1' }, { per_user_limit: 2147483648 },
    { start_time: undefined }, { start_time: 'invalid' }, { end_time: null }, { end_time: 'invalid' },
    { start_time: '2099-01-01T00:00:00.000Z' }, { end_time: '2010-01-01T00:00:00.000Z' },
    { type: 3, min_amount: 1 },
  ].map<[string, unknown]>(changes => [`invalid row ${JSON.stringify(changes)}`, response([{ ...coupon, ...changes }])]),
];

describe('coupon center successful read contract', () => {
  it.each(invalidResponses)('shows a recoverable read error for %s', async (_, reply) => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(reply as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载优惠券失败，请重试');
    expect(screen.queryByText('暂无可领取的优惠券')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即领取' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载优惠券' })).toBeEnabled();
    expect(couponApi.getAvailable).toHaveBeenCalledTimes(1);
    expect(couponApi.receive).not.toHaveBeenCalled();
  });

  it.each([Number.MIN_VALUE, 5e-10])('rejects a positive discount below one cent: %s', async discount => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response([{ ...coupon, type: 3, discount_value: discount }]) as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载优惠券失败，请重试');
    expect(screen.queryByRole('button', { name: '立即领取' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载优惠券' })).toBeEnabled();
    expect(couponApi.receive).not.toHaveBeenCalled();
  });

  it('accepts numeric cents with normal floating point arithmetic artifacts', async () => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response([{ ...coupon, type: 3, discount_value: 0.1 + 0.2, min_amount: 0, max_discount: 0 }]) as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByText(coupon.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即领取' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['zh-CN', 'en'] as const)('retries only the read and preserves a pending claim in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    useAuthStore.getState().login(customer, 'center-session');
    const session = JSON.stringify(['center-session', customer.user_id]);
    const key = prepareCouponClaim(session, coupon.coupon_id);
    const retry = deferred();
    vi.mocked(couponApi.getAvailable).mockResolvedValueOnce({} as never).mockReturnValueOnce(retry.promise as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(translate('加载优惠券失败，请重试'));
    const button = screen.getByRole('button', { name: translate('重新加载优惠券') });
    clickTogether(button, button); await settle();
    expect(couponApi.getAvailable).toHaveBeenCalledTimes(2);
    expect(couponApi.getAvailable).toHaveBeenLastCalledWith(1, 50);
    expect(couponApi.receive).not.toHaveBeenCalled();
    expect(readPendingCouponClaim(session, coupon.coupon_id)).toBe(key);
    await act(async () => retry.resolve(response())); await settle();
    expect(screen.getByText(coupon.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translate('重试领取') })).toBeEnabled();
    expect(readPendingCouponClaim(session, coupon.coupon_id)).toBe(key);
    expect(couponApi.receive).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '0.00', '5.00'])('accepts optional descriptions and SQL discount cap %s', async cap => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response([{ ...coupon, description: cap === undefined ? undefined : null, max_discount: cap }]) as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByText(coupon.name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即领取' })).toBeEnabled();
    expect(document.body.textContent?.includes('最高优惠')).toBe(cap === '5.00');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('accepts SQL ID, quantity and money boundaries without rounding decimal strings', async () => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response([{ ...coupon, coupon_id: 2147483647,
      total_quantity: 2147483647, remain_quantity: 2147483647, per_user_limit: 2147483647,
      type: 3, discount_value: '99999999.99', min_amount: '0.00', description: '' }]) as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByText('¥99999999.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即领取' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a real empty result distinct from malformed success', async () => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response([]) as never);
    render(<CouponsPage />); await settle();
    expect(screen.getByText('暂无可领取的优惠券')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(couponApi.receive).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [coupon] }])('allows collection changes between the count and rows reads: $rows', async ({ rows }) => {
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValue(response(rows, 2) as never);
    render(<CouponsPage />); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(rows.length ? coupon.name : '暂无可领取的优惠券')).toBeInTheDocument();
  });

  it('ignores a malformed old-session retry after another account signs in', async () => {
    const retry = deferred();
    useAuthStore.getState().login(customer, 'center-session');
    vi.mocked(couponApi.getAvailable).mockResolvedValueOnce({} as never).mockReturnValueOnce(retry.promise as never)
      .mockResolvedValueOnce(response([{ ...coupon, name: 'New account coupon' }]) as never);
    render(<CouponsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载优惠券' })); await settle();
    act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'other-session')); await settle();
    await act(async () => retry.resolve({})); await settle();
    expect(screen.getByText('New account coupon')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(couponApi.receive).not.toHaveBeenCalled();
  });
});
