import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/profile/page';
import { userApi, type UserStats } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { CommitLog, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ userApi: { getStats: vi.fn(), logout: vi.fn(async () => ({})) }, couponApi: { getMyCoupons: vi.fn(async () => ({ data: [] })) } }));

type Stats = { stats: UserStats };
const stats: UserStats = { totalOrders: 17, pendingOrders: 3, totalCoupons: 11, availableCoupons: 4, favoriteCount: 8 };
const customerA = { user_id: 1, username: 'Customer A', email: 'a@example.test' };
const customerB = { user_id: 2, username: 'Customer B', email: 'b@example.test' };

async function setup(getStats: () => Promise<unknown> = async () => ({ stats })) {
  useAuthStore.getState().login(customerA, 'A');
  vi.mocked(userApi.getStats).mockImplementation(async () => await getStats() as Stats);
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><ProfilePage /></CommitLog>);
  await settle();
  return { view, commits };
}

/** The count shown above each statistics card label. */
const counts = (label: string) => screen.getAllByText(label).map(element => element.previousElementSibling?.textContent);
const switchToB = () => act(() => useAuthStore.getState().login(customerB, 'B'));

describe('profile page', () => {
  it('shows server order, coupon and favorite counts and links pending orders to their filter', async () => {
    await setup();

    for (const [label, count] of [['我的订单', '17'], ['可用优惠券', '4'], ['我的收藏', '8'], ['待支付', '3']]) {
      expect(counts(label), `${label} should show ${count}`).toContain(count);
    }
    expect(userApi.getStats).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === '/orders?status=0')).toBe(true);
    expect(document.body.textContent).toContain('11');
  });

  it('shows an error instead of fabricated zeros when counts fail, and a retry loads accurate counts', async () => {
    let attempts = 0;
    await setup(async () => {
      if (++attempts === 1) throw new Error('offline');
      return { stats };
    });
    expect(screen.getByText(/统计数据加载失败/)).toBeInTheDocument();
    expect(counts('我的订单')).toContain('—');
    expect(vi.mocked(logger.error).mock.calls).toEqual([['加载统计数据失败:', new Error('offline')]]);

    fireEvent.click(screen.getByRole('button', { name: '重新加载统计' }));
    await settle();

    expect(attempts).toBe(2);
    expect(counts('我的订单')).toContain('17');
    expect(screen.queryByText(/统计数据加载失败/)).not.toBeInTheDocument();
  });

  it.each(['zh-CN', 'en'] as const)('recovers from a null stats reply with a read-only retry in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    let attempts = 0;
    await setup(async () => ++attempts === 1 ? null : { stats });
    const error = locale === 'en' ? 'Could not load account statistics. Please try again' : '统计数据加载失败，请重试';
    const retry = locale === 'en' ? 'Reload statistics' : '重新加载统计';
    const orders = locale === 'en' ? 'My orders' : '我的订单';

    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(counts(orders)).toContain('—');
    await settle();
    expect(attempts).toBe(1);
    expect(userApi.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('session')).toBe('A');

    fireEvent.click(screen.getByRole('button', { name: retry }));
    await settle();

    expect(attempts).toBe(2);
    expect(counts(orders)).toContain('17');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(userApi.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('session')).toBe('A');
  });

  it.each([
    undefined, {}, [], 'stats', { stats: null }, { stats: [] }, { stats: {} },
    { stats, success: false }, { stats, error: '获取个人统计失败' },
  ].map(response => ({ response })))('rejects a malformed stats envelope $response without publishing counts', async ({ response }) => {
    await setup(async () => response);
    expect(screen.getByRole('alert')).toHaveTextContent('统计数据加载失败，请重试');
    expect(counts('我的订单')).toContain('—');
    expect(screen.getByRole('button', { name: '重新加载统计' })).toBeInTheDocument();
    expect(userApi.getStats).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(stats) as (keyof UserStats)[])('rejects an invalid %s count before publishing other counts', async field => {
    await setup(async () => ({ stats: { ...stats, [field]: '4' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('统计数据加载失败，请重试');
    expect(counts('我的订单')).toContain('—');
    expect(counts('可用优惠券')).toContain('—');
    expect(counts('我的收藏')).toContain('—');
    expect(counts('待支付')).toContain('—');
  });

  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, true])('rejects a non-count value %s', async value => {
    await setup(async () => ({ stats: { ...stats, totalOrders: value } }));
    expect(screen.getByRole('alert')).toHaveTextContent('统计数据加载失败，请重试');
    expect(counts('我的订单')).toContain('—');
  });

  it('preserves a successful snapshot with all five counts at zero', async () => {
    await setup(async () => ({ stats: { totalOrders: 0, pendingOrders: 0, totalCoupons: 0, availableCoupons: 0, favoriteCount: 0 } }));
    for (const label of ['我的订单', '可用优惠券', '我的收藏', '待支付']) expect(counts(label)).toContain('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新加载统计' })).not.toBeInTheDocument();
    expect(userApi.getStats).toHaveBeenCalledTimes(1);
  });

  it("ignores customer A's late malformed stats after customer B signs in", async () => {
    const previous = deferred<unknown>();
    let attempts = 0;
    await setup(() => ++attempts === 1 ? previous.promise : Promise.resolve({ stats: { ...stats, totalOrders: 29 } }));
    switchToB();
    await settle();

    await act(async () => previous.resolve(null));
    await settle();

    expect(counts('我的订单')).toContain('29');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("ignores customer A's late counts after customer B signs in", async () => {
    const previous = deferred<Stats>();
    let attempts = 0;
    await setup(() => ++attempts === 1 ? previous.promise : Promise.resolve({ stats: { ...stats, totalOrders: 29 } }));

    switchToB();
    await settle();
    expect(attempts).toBe(2);
    expect(counts('我的订单')).toContain('29');

    await act(async () => previous.resolve({ stats }));
    await settle();
    expect(counts('我的订单')).toContain('29');
    expect(screen.queryByText(/Customer A/)).not.toBeInTheDocument();
  });

  it("hides customer A's loaded counts in customer B's first render", async () => {
    const { commits } = await setup();
    expect(counts('我的订单')).toContain('17');

    const before = commits.length;
    switchToB();

    expect(commits[before].textContent).not.toContain('17');
  });

  it('ignores a late failure after the account changes', async () => {
    const old = deferred<Stats>();
    let attempts = 0;
    await setup(() => ++attempts === 1 ? old.promise : Promise.resolve({ stats: { ...stats, totalOrders: 29 } }));
    switchToB();
    await settle();

    await act(async () => old.reject(new Error('old failure')));
    await settle();

    expect(screen.queryByText(/统计数据加载失败/)).not.toBeInTheDocument();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('ignores a late success after the page is left', async () => {
    const pending = deferred<Stats>();
    const { view } = await setup(() => pending.promise);

    view.unmount();
    await act(async () => pending.resolve({ stats }));
    await settle();

    expect(document.body.textContent).not.toContain('17');
  });

  it("cannot load another tab's customer through a retry before hydration catches up", async () => {
    await setup(async () => { throw new Error('offline'); });
    localStorage.setItem('session', 'B');

    fireEvent.click(screen.getByRole('button', { name: '重新加载统计' }));
    await settle();

    expect(userApi.getStats).toHaveBeenCalledTimes(1);
  });

  it('does not sign out the customer another tab signed in', async () => {
    await setup();
    localStorage.setItem('session', 'B');

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    expect(localStorage.getItem('session')).toBe('B');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('signs out here at once and asks the server to clear the session cookie', async () => {
    await setup();

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    expect(localStorage.getItem('session')).toBeNull();
    expect(userApi.logout).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/');
  });
});
