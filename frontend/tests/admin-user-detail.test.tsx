import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserDetailPage from '@/app/admin/users/[id]/page';
import api from '@/lib/api';
import { captureHandler, deferred, render, settle } from './helpers';

const route = vi.hoisted(() => ({ id: '7' as unknown }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: route.id }) }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
const customer = (id = 7) => ({ user_id: id, username: `Buyer ${id}`, email: 'buyer@example.test', phone: null, status: 1,
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T01:00:00Z', order_count: 11, total_spent: '60.60' });
const order = (id: number, userId = 7) => ({ order_id: id, user_id: userId, order_no: `ORDER-${id}`, total_amount: '10.10',
  status: id % 5, created_at: '2026-10-08T00:00:00Z', item_count: 2 });
const detail = (id = 7) => ({ user: customer(id), recent_orders: [order(11, id), order(10, id)], addresses: [
  { address_id: 1, user_id: id, receiver_name: 'Recipient', phone: '123456789', province: 'California', city: 'LA', district: null,
    detail_address: '123 Main Street', is_default: 1 },
] });
const orders = (page: number, id = 7, total = 11) => ({ orders: Array.from({ length: total }, (_, index) => order(total - index, id)).slice((page - 1) * 10, page * 10),
  pagination: { page, limit: 10, total, totalPages: Math.ceil(total / 10) } });
const rejected = (status = 500) => Object.assign(new Error('Read failed'), { response: { status, data: { error: '读取失败' } } });
type Call = { path?: string; page?: number; session: string | null };

async function setup(options: { readDetail?: (id: number) => Promise<unknown>; readOrders?: (id: number, page: number) => Promise<unknown> } = {}) {
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ username: 'Admin A' }));
  const calls: Call[] = [];
  api.defaults.adapter = async config => {
    const matched = config.url?.match(/^\/admin\/users\/(\d+)(\/orders)?$/);
    if (!matched || config.method !== 'get') throw new Error(`Unexpected request ${config.method} ${config.url}`);
    const id = Number(matched[1]);
    calls.push({ path: config.url, page: config.params?.page, session: localStorage.getItem('admin_session') });
    const data = matched[2]
      ? (options.readOrders ? await options.readOrders(id, config.params.page) : orders(config.params.page, id))
      : (options.readDetail ? await options.readDetail(id) : detail(id));
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const view = render(<UserDetailPage />);
  await settle();
  return { calls, view, rerender: () => act(() => view.rerender(<UserDetailPage />)) };
}

beforeEach(() => { route.id = '7'; });
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('admin customer detail', () => {
  it('shows profile, real spending, addresses and recent orders using the existing read endpoints', async () => {
    const { calls } = await setup();
    expect(screen.getByRole('heading', { name: '用户详情' })).toBeInTheDocument();
    expect(screen.getByText('Buyer 7')).toBeInTheDocument();
    expect(screen.getByText('buyer@example.test')).toBeInTheDocument();
    expect(screen.getByText('¥60.60')).toBeInTheDocument();
    expect(screen.getByText('Recipient')).toBeInTheDocument();
    expect(screen.getByText('California LA 123 Main Street')).toBeInTheDocument();
    expect(screen.getByText('默认地址')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '最近订单' })).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('link', { name: '返回用户列表' })).toHaveAttribute('href', '/admin/users');
    expect(screen.queryByRole('button', { name: '禁用' })).not.toBeInTheDocument();
    expect(calls).toEqual([{ path: '/admin/users/7', page: undefined, session: 'admin-a' },
      { path: '/admin/users/7/orders', page: 1, session: 'admin-a' }]);
  });

  it('pages through the customer orders and ignores an older page handler', async () => {
    const { calls } = await setup();
    const oldNext = captureHandler(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '全部订单' })).getAllByRole('row')).toHaveLength(2);
    expect(within(screen.getByRole('table', { name: '全部订单' })).getByText('ORDER-1')).toBeInTheDocument();
    await oldNext(); await settle();
    expect(calls).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '上一页' })); await settle();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ path: '/admin/users/7/orders', page: 1 });
  });

  it('renders useful empty states and handles absent optional address fields', async () => {
    await setup({ readDetail: async () => ({ user: { ...customer(), phone: '', total_spent: null, order_count: 0 }, recent_orders: [], addresses: [
      { address_id: 1, receiver_name: 'Recipient', phone: '', is_default: 0 },
    ] }), readOrders: async () => orders(1, 7, 0) });
    expect(screen.getByText('暂无最近订单')).toBeInTheDocument();
    expect(screen.getByText('暂无订单')).toBeInTheDocument();
    expect(screen.getByText('¥0.00')).toBeInTheDocument();
    expect(screen.getAllByText('暂无')).not.toHaveLength(0);
  });

  it('shows an empty address list without editing controls', async () => {
    await setup({ readDetail: async () => ({ ...detail(), addresses: [] }) });
    expect(screen.getByText('暂无收货地址')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑|删除|新增/ })).not.toBeInTheDocument();
  });

  it('shows detail loading then recovers a failed read without duplicate retry requests', async () => {
    const replacement = deferred();
    let reads = 0;
    await setup({ readDetail: async () => ++reads === 1 ? Promise.reject(rejected()) : replacement.promise });
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败');
    const retry = screen.getByRole('button', { name: '重新加载用户详情' });
    act(() => { retry.click(); retry.click(); }); await settle();
    expect(reads).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载用户详情...');
    await act(async () => replacement.resolve(detail())); await settle();
    expect(screen.getByText('Buyer 7')).toBeInTheDocument();
  });

  it.each([[403, '无权查看用户详情'], [404, '用户不存在']] as const)('shows an explicit %s response and back/retry recovery', async (status, message) => {
    const { calls } = await setup({ readDetail: async () => { throw rejected(status); } });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('link', { name: '返回用户列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载用户详情' })).toBeEnabled();
    expect(calls).toHaveLength(1);
  });

  it.each([undefined, ['7'], '', '0', '-1', '7x', '007', '1.5', '9007199254740992'])('rejects a malformed route parameter %j without requesting data', async id => {
    route.id = id;
    const { calls } = await setup();
    expect(screen.getByRole('alert')).toHaveTextContent('用户ID无效');
    expect(calls).toHaveLength(0);
  });

  it('keeps the profile and recent orders visible while failed paginated orders can be retried', async () => {
    let reads = 0;
    await setup({ readOrders: async () => ++reads === 1 ? Promise.reject(rejected(403)) : orders(1) });
    expect(screen.getByText('Buyer 7')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('无权查看用户订单');
    fireEvent.click(screen.getByRole('button', { name: '重新加载用户订单' })); await settle();
    expect(reads).toBe(2);
    expect(screen.getByRole('table', { name: '全部订单' })).toBeInTheDocument();
  });

  it('rejects a different customer detail response and offers a retry', async () => {
    await setup({ readDetail: async () => detail(8) });
    expect(screen.getByRole('alert')).toHaveTextContent('用户详情数据无效，请重新加载');
    expect(screen.queryByText('Buyer 8')).not.toBeInTheDocument();
  });

  it('rejects invalid order pagination without affecting the detail', async () => {
    await setup({ readOrders: async () => ({ ...orders(1), pagination: { total: 11, page: 2 } }) });
    expect(screen.getByRole('alert')).toHaveTextContent('用户订单数据无效，请重新加载');
    expect(screen.getByText('Buyer 7')).toBeInTheDocument();
  });

  it('clamps the last order page if orders disappear without flashing an empty table', async () => {
    let shrinking = false;
    const { calls } = await setup({ readOrders: async (id, page) => {
      if (page === 2) shrinking = true;
      return orders(page, id, shrinking ? 10 : 11);
    } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ page: 1 });
    expect(within(screen.getByRole('table', { name: '全部订单' })).getAllByRole('row')).toHaveLength(11);
  });

  it('resets order pagination for a new route and ignores the old late response', async () => {
    const pending = deferred();
    const { rerender } = await setup({ readOrders: async (id, page) => id === 7 && page === 2 ? pending.promise : orders(page, id) });
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    route.id = '8'; rerender(); await settle();
    expect(screen.getByText('Buyer 8')).toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    await act(async () => pending.resolve(orders(2))); await settle();
    expect(screen.queryByText('Buyer 7')).not.toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
  });

  it('hides the old administrator data immediately, resets pagination and ignores stale reload handlers', async () => {
    const { calls } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    const oldPrevious = captureHandler(screen.getByRole('button', { name: '上一页' }));
    localStorage.setItem('admin_session', 'admin-b');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })));
    await settle();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    await oldPrevious(); await settle();
    expect(calls.at(-1)).toMatchObject({ page: 1, session: 'admin-b' });
    expect(calls.filter(call => call.session === 'admin-b')).toHaveLength(2);
  });

  it('does not send requests from a captured detail retry after unmount', async () => {
    const { calls, view } = await setup({ readDetail: async () => { throw rejected(); } });
    const retry = captureHandler(screen.getByRole('button', { name: '重新加载用户详情' }));
    view.unmount(); await retry(); await settle();
    expect(calls).toHaveLength(1);
  });
});
