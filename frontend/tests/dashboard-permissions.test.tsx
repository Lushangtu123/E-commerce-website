import { act, screen, within } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from '@/app/admin/dashboard/page';
import api, { type DashboardStats, type RecentOrder, type SalesTrendPoint, type TopProduct } from '@/lib/api';
import { clearAdminSession } from '@/lib/admin-session';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
// The shared frame has its own session tests; this suite exercises dashboard sections.
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
// Chart layout measurements are unavailable in happy-dom. Preserve the visible series supplied by the page.
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Box,
    LineChart: ({ data, children }: { data: SalesTrendPoint[]; children?: ReactNode }) => (
      <div>{data.map(point => <output key={point.date}>{point.date}: {point.revenue}</output>)}{children}</div>
    ),
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty,
  };
});

const stats: DashboardStats = {
  today_orders: 7, today_revenue: 123.45, new_users: 3, pending_orders: 2,
  total_products: 12, active_products: 11, order_growth: 25, revenue_growth: 10,
};
const orders: RecentOrder[] = [{ order_id: 1, order_no: 'ORDER-AUTHORIZED', username: 'Buyer', total_amount: '45.00', status: 2, created_at: '2026-10-07T12:00:00Z' }];
const products: TopProduct[] = [{ product_id: 1, title: '授权商品', total_sales: 4, total_revenue: '123.45' }];
const trend: SalesTrendPoint[] = [{ date: '2026-10-07', order_count: 7, revenue: '123.45' }];
const originalAdapter = api.defaults.adapter;

function signIn(session = 'admin-session', role = 'data_analyst') {
  localStorage.setItem('admin_session', session);
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: role, role_name: role }));
}

function success(config: InternalAxiosRequestConfig) {
  if (config.url === '/admin/dashboard/stats') return stats;
  if (config.url === '/admin/dashboard/recent-orders') return orders;
  if (config.url === '/admin/dashboard/top-products') return products;
  if (config.url === '/admin/dashboard/sales-trend') return trend;
  throw new Error(`Unexpected request: ${config.url}`);
}

function failure(config: InternalAxiosRequestConfig, status: number, error?: string) {
  return Object.assign(new Error('Request failed'), { config, response: { status, data: error ? { error } : {} } });
}

async function setup(answer: (config: InternalAxiosRequestConfig) => unknown, role = 'data_analyst') {
  signIn('admin-session', role);
  const adapter: AxiosAdapter = async config => ({ data: await answer(config), status: 200, statusText: 'OK', headers: {}, config });
  api.defaults.adapter = adapter;
  const view = render(<AdminDashboardPage />);
  await settle();
  return view;
}

const section = (title: string) => screen.getByRole('heading', { name: title }).closest('.bg-white') as HTMLElement;

afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('dashboard permission sections', () => {
  it.each(['stats', 'recent-orders', 'top-products', 'sales-trend'])('retries only the failed %s section and coalesces repeated actions', async name => {
    const target = `/admin/dashboard/${name}`;
    const retry = deferred<unknown>(); const calls: string[] = [];
    await setup(config => {
      calls.push(config.url!);
      if (config.url === target) {
        if (calls.filter(url => url === target).length === 1) throw failure(config, 503, '获取数据失败');
        return retry.promise;
      }
      return success(config);
    });
    const action = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    const first = action(); const second = action(); await settle();
    expect(calls.filter(url => url === target)).toHaveLength(2);
    expect(calls.filter(url => url !== target)).toHaveLength(3);
    await act(async () => retry.resolve(success({ url: target } as InternalAxiosRequestConfig)));
    await Promise.all([first, second]); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
    expect(screen.getByText('授权商品')).toBeVisible();
  });

  it('does not offer a retry for an explicit permission denial', async () => {
    await setup(config => { if (config.url === '/admin/dashboard/recent-orders') throw failure(config, 403); return success(config); });
    expect(screen.getByRole('alert')).toHaveTextContent('权限不足');
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });

  it('keeps a failed retry recoverable and updates its controls with the current language', async () => {
    let attempts = 0;
    await setup(config => {
      if (config.url === '/admin/dashboard/recent-orders' && ++attempts < 3) throw failure(config, 503);
      return success(config);
    });
    act(() => useLocaleStore.setState({ locale: 'en' }));
    await captureHandler(screen.getByRole('button', { name: 'Retry' }))(); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load data');
    await captureHandler(screen.getByRole('button', { name: 'Retry' }))(); await settle();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
    expect(attempts).toBe(3);
  });

  it('rejects an old retry handler after the administrator session changes', async () => {
    const calls: string[] = [];
    const view = await setup(config => {
      calls.push(config.url!);
      if (config.url === '/admin/dashboard/recent-orders') throw failure(config, 503);
      return success(config);
    });
    const oldRetry = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    signIn('second-admin'); view.rerender(<AdminDashboardPage />); await settle();
    const before = calls.length; await oldRetry(); await settle();
    expect(calls).toHaveLength(before);
  });

  it('shows an analyst the authorized statistics when recent orders return 403', async () => {
    await setup(config => {
      if (config.url === '/admin/dashboard/recent-orders') throw failure(config, 403, '权限不足');
      return success(config);
    });

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('授权商品')).toBeInTheDocument();
    expect(screen.getByText('2026-10-07: 123.45')).toBeInTheDocument();
    expect(within(section('最近订单')).getByRole('alert')).toHaveTextContent('权限不足');
    expect(screen.queryByText('暂无订单数据')).not.toBeInTheDocument();
    expect(screen.queryByText('ORDER-AUTHORIZED')).not.toBeInTheDocument();
    expect(localStorage.getItem('admin_session')).toBe('admin-session');
  });

  it('shows order-only staff their orders without fabricating zero statistics or empty sales data', async () => {
    await setup(config => {
      if (config.url !== '/admin/dashboard/recent-orders') throw failure(config, 403);
      return orders;
    }, 'order_manager');

    expect(screen.getByText('ORDER-AUTHORIZED')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    for (const alert of screen.getAllByRole('alert')) expect(alert).toHaveTextContent('权限不足');
    expect(screen.queryByText('今日订单')).not.toBeInTheDocument();
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无销售数据')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
  });

  it('renders completed sections while another request is still pending', async () => {
    const delayed = deferred<RecentOrder[]>();
    await setup(config => config.url === '/admin/dashboard/recent-orders' ? delayed.promise : success(config));

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('授权商品')).toBeInTheDocument();
    expect(within(section('最近订单')).getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('暂无订单数据')).not.toBeInTheDocument();

    delayed.resolve(orders);
    await settle();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeInTheDocument();
  });

  it('shows a translated section failure while keeping other authorized results visible', async () => {
    await setup(config => {
      if (config.url === '/admin/dashboard/top-products') throw failure(config, 500, '获取数据失败');
      return success(config);
    }, 'super_admin');

    act(() => useLocaleStore.getState().setLocale('en'));
    expect(within(section('Top products (last 7 days)')).getByRole('alert')).toHaveTextContent('Unable to load data');
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('keeps every section available to a fully authorized administrator', async () => {
    await setup(success, 'super_admin');

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('授权商品')).toBeInTheDocument();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeInTheDocument();
    expect(screen.getByText('2026-10-07: 123.45')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears expired administrator access through the existing 401 handling and keeps the customer session', async () => {
    localStorage.setItem('session', 'customer-session');
    await setup(config => { throw failure(config, 401, '登录已过期，请重新登录'); });

    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(new URL(window.location.href).pathname).toBe('/admin/login');
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });

  it('hides the loaded dashboard as soon as this administrator signs out', async () => {
    await setup(success, 'super_admin');
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeInTheDocument();

    act(() => { clearAdminSession('admin-session'); });

    expect(screen.queryByText('ORDER-AUTHORIZED')).not.toBeInTheDocument();
    expect(screen.queryByText('授权商品')).not.toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });
});
