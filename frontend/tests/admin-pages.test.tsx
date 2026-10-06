import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCouponsPage from '@/app/admin/coupons/page';
import AdminDashboardPage from '@/app/admin/dashboard/page';
import AdminOrdersPage from '@/app/admin/orders/page';
import api, { type AdminOrderRow } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { deferred, render, settle } from './helpers';

/**
 * The administrator sign-in a request went out for. The httpOnly cookie names it to the API, so a
 * request that still carried a token header would show up here as that header instead.
 */
const sentSession = (config: { headers: { get(name: string): unknown } }) =>
  config.headers.get('Authorization') ?? `session:${localStorage.getItem('admin_session')}`;


// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});
// Marks where the shared admin frame wraps a page; the frame itself is tested in admin-session.test.tsx.
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <div data-testid="admin-layout">{children}</div> }));
// Charts need layout measurements happy-dom does not provide; the dashboard tests are about its tables.
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return { ResponsiveContainer: Box, LineChart: Box, Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty };
});

const statusLabels = ['待支付', '已支付', '已发货', '已完成', '已取消'];
const orders: AdminOrderRow[] = Array.from({ length: 5 }, (_, status) => ({
  order_id: status + 1, order_no: `ORDER-${status}`, status, total_amount: '10.00', created_at: '2026-10-02T00:00:00.000Z',
}));
const originalAdapter = api.defaults.adapter;
let requests: InternalAxiosRequestConfig[] = [];

/** A customer and an administrator are both signed in, as when one person runs the shop. */
function signIn(adminToken = 'admin-session', adminUser = JSON.stringify({ admin_id: 1, username: 'Admin' })) {
  localStorage.setItem('session', 'customer-session');
  localStorage.setItem('user', JSON.stringify({ user_id: 1, username: 'customer', email: 'customer@example.test' }));
  localStorage.setItem('admin_session', adminToken);
  localStorage.setItem('admin_user', adminUser);
  useAuthStore.getState().hydrate();
}

function answer(respond: (config: InternalAxiosRequestConfig) => unknown) {
  const adapter: AxiosAdapter = async config => {
    requests.push(config);
    return { data: await respond(config), status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

async function renderOrders(rows: AdminOrderRow[] = orders) {
  signIn();
  vi.stubGlobal('confirm', () => true);
  answer(() => ({ orders: rows, pagination: { total: rows.length } }));
  render(<AdminOrdersPage />);
  await settle();
}

const badges = () => Array.from(document.querySelectorAll('span.rounded-full'), badge => badge.textContent);

async function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await settle();
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('admin orders', () => {
  it('shows the saved shipping snapshot instead of current address aliases and identifies legacy orders', async () => {
    const snapshot = { receiver_name: 'Original Receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '旧地址 1 号' };
    await renderOrders([
      // Current-address aliases are not part of the row type; the page must ignore them.
      { ...orders[0], shipping_address_snapshot: snapshot, receiver_name: 'Current Receiver', detail_address: '新地址' } as AdminOrderRow,
      { ...orders[1], shipping_address_snapshot: null },
    ]);

    expect(screen.getByText(/Original Receiver/)).toBeInTheDocument();
    expect(screen.getByText('浙江省杭州市西湖区旧地址 1 号')).toBeInTheDocument();
    expect(screen.queryByText(/Current Receiver/)).not.toBeInTheDocument();
    expect(screen.getByText('历史订单未记录收货信息')).toBeInTheDocument();
  });

  it('displays and filters the same five statuses as customer orders', async () => {
    await renderOrders();

    const options = Array.from(screen.getByRole<HTMLSelectElement>('combobox', { name: '订单状态' }).options);
    expect(options.map(option => option.value)).toEqual(['', '0', '1', '2', '3', '4']);
    expect(options.slice(1).map(option => option.textContent)).toEqual(statusLabels);
    expect(badges()).toEqual(statusLabels);
  });

  it('offers only legal next states and sends them with admin credentials before refreshing', async () => {
    await renderOrders();
    const actions = screen.getAllByRole('button', { name: /^(取消订单|发货|完成订单)$/ });
    expect(actions.map(action => action.textContent)).toEqual(['取消订单', '发货', '完成订单']);

    await click('取消订单');
    await click('发货');
    expect(requests.filter(config => config.method === 'put')).toHaveLength(1);
    fireEvent.change(document.querySelector('input[name="shipping_company"]')!, { target: { value: 'SF Express' } });
    fireEvent.change(document.querySelector('input[name="tracking_number"]')!, { target: { value: 'SF123456' } });
    fireEvent.submit(document.querySelector('form')!);
    await settle();
    await click('完成订单');

    const updates = requests.filter(config => config.method === 'put');
    expect(updates.map(config => [config.url, JSON.parse(config.data).status])).toEqual([
      ['/admin/orders/1/status', 4], ['/admin/orders/2/status', 2], ['/admin/orders/3/status', 3],
    ]);
    for (const config of requests) expect(sentSession(config)).toBe('session:admin-session');
    expect(JSON.parse(updates[1].data)).toEqual({ status: 2, shipping_company: 'SF Express', tracking_number: 'SF123456' });
    expect(requests.filter(config => config.method === 'get').length).toBeGreaterThanOrEqual(4);
  });
});

describe('admin dashboard', () => {
  it('labels recent orders with the customer order status contract', async () => {
    signIn();
    answer(config => {
      if (config.url === '/admin/dashboard/recent-orders') return orders;
      if (config.url === '/admin/dashboard/stats') {
        return { today_orders: 0, today_revenue: 0, new_users: 0, pending_orders: 0, total_products: 0, active_products: 0, order_growth: 0, revenue_growth: 0 };
      }
      return [];
    });

    render(<AdminDashboardPage />);
    await settle();

    expect(badges()).toEqual(statusLabels);
  });

  it('returns an expired administrator to admin login and keeps the customer signed in', async () => {
    signIn('expired-admin-session', '{"admin_id":2}');
    const adapter: AxiosAdapter = async config => {
      throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
    };
    api.defaults.adapter = adapter;

    render(<AdminDashboardPage />);
    await settle();

    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(new URL(window.location.href).pathname).toBe('/admin/login');
  });
});

describe('admin coupons', () => {
  it('keeps the admin frame while loading and after loading', async () => {
    signIn();
    const list = deferred();
    answer(() => list.promise);
    const { container } = render(<AdminCouponsPage />);
    await settle();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-testid', 'admin-layout');

    await act(async () => list.resolve({ data: [] }));
    await settle();
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-testid', 'admin-layout');
  });
});
