import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/profile/page';
import { userApi, type UserStats } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { CommitLog, deferred, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ userApi: { getStats: vi.fn() }, couponApi: { getMyCoupons: vi.fn(async () => ({ data: [] })) } }));

type Stats = { stats: UserStats };
const stats: UserStats = { totalOrders: 17, pendingOrders: 3, totalCoupons: 11, availableCoupons: 4, favoriteCount: 8 };
const customerA = { user_id: 1, username: 'Customer A', email: 'a@example.test' };
const customerB = { user_id: 2, username: 'Customer B', email: 'b@example.test' };

async function setup(getStats: () => Promise<Stats> = async () => ({ stats })) {
  useAuthStore.getState().login(customerA, 'A');
  vi.mocked(userApi.getStats).mockImplementation(getStats);
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

    fireEvent.click(screen.getByRole('button', { name: '重新加载统计' }));
    await settle();

    expect(attempts).toBe(2);
    expect(counts('我的订单')).toContain('17');
    expect(screen.queryByText(/统计数据加载失败/)).not.toBeInTheDocument();
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
    localStorage.setItem('token', 'B');

    fireEvent.click(screen.getByRole('button', { name: '重新加载统计' }));
    await settle();

    expect(userApi.getStats).toHaveBeenCalledTimes(1);
  });
});
