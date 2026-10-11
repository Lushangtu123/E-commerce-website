import { act, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from '@/app/admin/dashboard/page';
import api, { type DashboardStats, type RecentOrder, type SalesTrendPoint, type TopProduct } from '@/lib/api';
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

async function setup(answer: (config: InternalAxiosRequestConfig) => unknown, role = 'data_analyst') {
  signIn('admin-session', role);
  const adapter: AxiosAdapter = async config => ({ data: await answer(config), status: 200, statusText: 'OK', headers: {}, config });
  api.defaults.adapter = adapter;
  const view = render(<DashboardBoundary><AdminDashboardPage /></DashboardBoundary>);
  await settle();
  return view;
}

class DashboardBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <p>Dashboard crashed</p> : this.props.children; }
}

const sectionNames = ['stats', 'recent-orders', 'top-products', 'sales-trend'] as const;
type SectionName = typeof sectionNames[number];

function expectSectionFailure(name: SectionName) {
  expect(screen.getByRole('alert')).toHaveTextContent('获取数据失败');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible();
  expect(screen.queryByText('Dashboard crashed')).not.toBeInTheDocument();
  if (name !== 'stats') expect(screen.getByText('7')).toBeVisible();
  if (name !== 'recent-orders') expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
  if (name !== 'top-products') expect(screen.getByText('授权商品')).toBeVisible();
  if (name !== 'sales-trend') expect(screen.getByText('2026-10-07: 123.45')).toBeVisible();
  expect(screen.queryByText('暂无订单数据')).not.toBeInTheDocument();
  expect(screen.queryByText('暂无销售数据')).not.toBeInTheDocument();
  expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
  expect(localStorage.getItem('admin_session')).toBe('admin-session');
}

afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('dashboard response validation', () => {
  const statsFields = Object.keys(stats) as (keyof DashboardStats)[];
  const malformedStats = statsFields.flatMap(field => [
    { label: `missing ${field}`, data: Object.fromEntries(Object.entries(stats).filter(([key]) => key !== field)) },
    { label: `null ${field}`, data: { ...stats, [field]: null } },
    { label: `object ${field}`, data: { ...stats, [field]: {} } },
  ]);

  it.each(malformedStats)('rejects stats with $label without hiding other sections', async ({ data }) => {
    await setup(config => config.url === '/admin/dashboard/stats' ? data : success(config));
    expectSectionFailure('stats');
    expect(screen.queryByText('今日订单')).not.toBeInTheDocument();
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
  });

  it.each([
    { label: 'empty revenue', field: 'today_revenue', value: '' },
    { label: 'whitespace revenue', field: 'today_revenue', value: ' ' },
    { label: 'boolean revenue', field: 'today_revenue', value: false },
    { label: 'array revenue', field: 'today_revenue', value: [] },
    { label: 'invalid revenue', field: 'today_revenue', value: 'invalid' },
    { label: 'nonfinite revenue string', field: 'today_revenue', value: 'Infinity' },
    { label: 'negative revenue', field: 'today_revenue', value: -1 },
    { label: 'fractional order count', field: 'today_orders', value: 0.5 },
    { label: 'nonfinite growth', field: 'order_growth', value: Infinity },
    { label: 'NaN growth', field: 'revenue_growth', value: NaN },
  ])('rejects $label in stats', async ({ field, value }) => {
    await setup(config => config.url === '/admin/dashboard/stats' ? { ...stats, [field]: value } : success(config));
    expectSectionFailure('stats');
  });

  it.each([null, false, []])('rejects a stats response of %s', async data => {
    await setup(config => config.url === '/admin/dashboard/stats' ? data : success(config));
    expectSectionFailure('stats');
  });

  it.each(sectionNames)('rejects a missing %s response object', async name => {
    await setup(config => config.url === `/admin/dashboard/${name}` ? {} : success(config));
    expectSectionFailure(name);
  });

  const listSections = [
    { name: 'recent-orders', key: 'orders', row: orders[0] },
    { name: 'top-products', key: 'products', row: products[0] },
    { name: 'sales-trend', key: 'trend', row: trend[0] },
  ] as const;

  it.each(listSections.flatMap(({ name, key }) => [
    { name, label: 'null response', data: null },
    { name, label: 'wrong response type', data: 0 },
    { name, label: 'null list', data: { [key]: null } },
    { name, label: 'object list', data: { [key]: {} } },
    { name, label: 'string list', data: { [key]: 'invalid' } },
  ]))('rejects $name $label', async ({ name, data }) => {
    await setup(config => config.url === `/admin/dashboard/${name}` ? data : success(config));
    expectSectionFailure(name);
  });

  it.each(listSections.flatMap(({ name, key, row }) => [
    { name, label: 'null row', data: [row, null] },
    { name, label: 'missing row fields', data: [row, {}] },
    { name, label: 'wrong row type inside wrapper', data: { [key]: [row, false] } },
  ]))('rejects the whole $name section for a $label', async ({ name, data }) => {
    await setup(config => config.url === `/admin/dashboard/${name}` ? data : success(config));
    expectSectionFailure(name);
    const hidden = { 'recent-orders': 'ORDER-AUTHORIZED', 'top-products': '授权商品', 'sales-trend': '2026-10-07: 123.45' };
    expect(screen.queryByText(hidden[name])).not.toBeInTheDocument();
  });

  it.each([
    { name: 'recent-orders', label: 'missing order number', row: { ...orders[0], order_no: undefined } },
    { name: 'recent-orders', label: 'null amount', row: { ...orders[0], total_amount: null } },
    { name: 'recent-orders', label: 'invalid status', row: { ...orders[0], status: 99 } },
    { name: 'recent-orders', label: 'invalid timestamp', row: { ...orders[0], created_at: 'not-a-date' } },
    { name: 'recent-orders', label: 'object username', row: { ...orders[0], username: {} } },
    { name: 'top-products', label: 'object title', row: { ...products[0], title: {} } },
    { name: 'top-products', label: 'invalid English title', row: { ...products[0], title_en: 1 } },
    { name: 'top-products', label: 'boolean sales', row: { ...products[0], total_sales: true } },
    { name: 'top-products', label: 'invalid revenue', row: { ...products[0], total_revenue: 'NaN' } },
    { name: 'sales-trend', label: 'object date', row: { ...trend[0], date: {} } },
    { name: 'sales-trend', label: 'impossible calendar date', row: { ...trend[0], date: '2026-02-30' } },
    { name: 'sales-trend', label: 'null revenue', row: { ...trend[0], revenue: null } },
    { name: 'sales-trend', label: 'nonfinite revenue', row: { ...trend[0], revenue: '1' + '0'.repeat(400) } },
    { name: 'sales-trend', label: 'array count', row: { ...trend[0], order_count: [] } },
  ] as const)('rejects $name $label before rendering a row', async ({ name, row }) => {
    await setup(config => config.url === `/admin/dashboard/${name}` ? [row] : success(config));
    expectSectionFailure(name);
  });

  it.each(sectionNames)('retries only the invalid %s response and coalesces repeated retry actions', async name => {
    const target = `/admin/dashboard/${name}`;
    const retry = deferred<unknown>();
    const calls: string[] = [];
    await setup(config => {
      calls.push(config.url!);
      if (config.url === target) return calls.filter(url => url === target).length === 1 ? {} : retry.promise;
      return success(config);
    });
    expectSectionFailure(name);
    const action = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    const first = action(); const second = action(); await settle();
    expect(calls.filter(url => url === target)).toHaveLength(2);
    expect(calls.filter(url => url !== target)).toHaveLength(3);
    await act(async () => retry.resolve(success({ url: target } as InternalAxiosRequestConfig)));
    await Promise.all([first, second]); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
    expect(screen.getByText('授权商品')).toBeVisible();
  });

  it('keeps invalid retries recoverable and translates the existing error and retry controls', async () => {
    let attempts = 0;
    await setup(config => config.url === '/admin/dashboard/recent-orders' && ++attempts < 3 ? {} : success(config));
    expectSectionFailure('recent-orders');
    act(() => useLocaleStore.setState({ locale: 'en' }));
    await captureHandler(screen.getByRole('button', { name: 'Retry' }))(); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load data');
    expect(screen.getByText('授权商品')).toBeVisible();
    await captureHandler(screen.getByRole('button', { name: 'Retry' }))(); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
    expect(attempts).toBe(3);
  });

  it.each([false, true])('preserves all-zero stats and genuinely empty lists (wrappers: %s)', async wrappers => {
    await setup(config => config.url === '/admin/dashboard/stats' ? Object.fromEntries(Object.keys(stats).map(key => [key, 0]))
      : wrappers ? { [listSections.find(section => config.url?.endsWith(section.name))!.key]: [] } : []);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('¥0.00')).toBeVisible();
    expect(screen.getByText('暂无订单数据')).toBeVisible();
    expect(screen.getByText('暂无销售数据')).toBeVisible();
    expect(screen.getByText('暂无数据')).toBeVisible();
  });

  it('preserves the MySQL empty-product-table SUM while requiring a known zero product total', async () => {
    await setup(config => config.url === '/admin/dashboard/stats' ? { ...stats, total_products: 0, active_products: null } : success(config));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('ORDER-AUTHORIZED')).toBeVisible();
  });

  it.each([false, true])('accepts finite MySQL decimal strings and optional nullable text (wrappers: %s)', async wrappers => {
    await setup(config => {
      if (config.url === '/admin/dashboard/stats') return { ...stats, today_revenue: '123.45', active_products: '11', order_growth: -25, revenue_growth: -10 };
      const zero = wrappers ? '0.00' : 0;
      const definition = listSections.find(section => config.url?.endsWith(section.name))!;
      const rows = definition.name === 'recent-orders' ? [{ ...orders[0], username: null, total_amount: zero }]
        : definition.name === 'top-products' ? [{ ...products[0], title_en: 'Authorized product', total_sales: '4', total_revenue: zero }]
        : [{ ...trend[0], revenue: zero }];
      return wrappers ? { [definition.key]: rows } : rows;
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('¥123.45')).toBeVisible();
    expect(screen.getByText('未知用户')).toBeVisible();
    expect(screen.getAllByText('¥0.00')).toHaveLength(2);
    expect(screen.getByText(`2026-10-07: ${wrappers ? '0.00' : 0}`)).toBeVisible();
    act(() => useLocaleStore.setState({ locale: 'en' }));
    expect(screen.getByText('Authorized product')).toBeVisible();
    expect(screen.getByText('Unknown user')).toBeVisible();
    expect(screen.getByText('Sold: 4')).toBeVisible();
  });
});
