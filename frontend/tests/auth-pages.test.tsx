import { act } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import CouponsPage from '@/app/coupons/page';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import MyCouponsPage from '@/app/my/coupons/page';
import OrderDetailPage from '@/app/orders/[id]/page';
import OrdersPage from '@/app/orders/page';
import ProfileAddressPage from '@/app/profile/address/page';
import ProfilePage from '@/app/profile/page';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const requests = vi.hoisted(() => [] as { api: string; method: string }[]);
vi.mock('next/navigation', () => ({
  useRouter: () => router, useParams: () => ({ id: '1' }), usePathname: () => '/', useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
// Every API object records any method called on it and answers with an empty result of every shape these pages read.
vi.mock('@/lib/api', () => {
  const empty = { data: [], items: [], orders: [], favorites: [], history: [], coupons: [], addresses: [], pagination: { total: 0 }, order: { status: 3 } };
  const recorder = (api: string) => new Proxy({}, {
    get: (_, method) => typeof method === 'string' ? vi.fn(async () => { requests.push({ api, method }); return empty; }) : undefined,
  });
  const names = ['addressApi', 'cartApi', 'orderApi', 'orderTimeoutApi', 'paymentApi', 'couponApi', 'favoriteApi', 'browseApi', 'userApi', 'reviewApi', 'afterSalesApi'];
  return Object.fromEntries(names.map(name => [name, recorder(name)]));
});
// The order detail page's completed-order sections load their own data and are tested elsewhere.
vi.mock('@/components/OrderReviews', () => ({ default: () => null }));
vi.mock('@/components/OrderAfterSales', () => ({ default: () => null }));

const pages: [string, ComponentType, number][] = [
  ['cart', CartPage, 2], ['coupons', CouponsPage, 1], ['favorites', FavoritesPage, 1], ['history', HistoryPage, 1],
  ['orders', OrdersPage, 2], ['orders/[id]', OrderDetailPage, 2], ['profile', ProfilePage, 1],
  ['profile/address', ProfileAddressPage, 1], ['my/coupons', MyCouponsPage, 1],
];

describe.each(pages)('protected page %s', (_, Page, expectedRequests) => {
  beforeEach(() => {
    requests.length = 0;
  });

  it('waits for hydration, then loads the persisted session without redirecting', async () => {
    render(<Page />);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(requests).toEqual([]);

    localStorage.setItem('session', 'customer-session');
    localStorage.setItem('user', JSON.stringify({ user_id: 1, username: 'customer', email: 'customer@example.test' }));
    act(() => useAuthStore.getState().hydrate());
    await settle();

    expect(router.push).not.toHaveBeenCalled();
    expect(requests).toHaveLength(expectedRequests);
    if (Page === CartPage) expect(requests.map(request => request.api)).toEqual(['cartApi', 'addressApi']);
  });

  it('redirects an anonymous visitor to login only after hydration finishes', async () => {
    render(<Page />);
    await settle();
    expect(router.push).not.toHaveBeenCalled();

    act(() => useAuthStore.getState().hydrate());
    await settle();

    expect(router.push.mock.calls).toEqual([['/login']]);
    expect(requests).toEqual([]);
  });
});
