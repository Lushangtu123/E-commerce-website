import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '@/app/admin/users/page';
import api from '@/lib/api';
import { captureHandler, deferred, render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: notifications }));

const originalAdapter = api.defaults.adapter;
const user = (id = 1, status = 1) => ({ user_id: id, username: `Buyer ${id}`, email: 'buyer@example.test', phone: null,
  status, created_at: '2026-10-08T00:00:00Z', order_count: 2, total_spent: '49.90' });
const detail = (row = user()) => ({ user: row, recent_orders: [], addresses: [] });
const list = (rows = [user()], page = 1, total = rows.length) => ({ users: rows,
  pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) } });
const networkError = () => Object.assign(new Error('Response lost'), { code: 'ERR_NETWORK' });
const responseError = (status: number) => Object.assign(new Error('Rejected'), { response: { status, data: { error: '无权限' } } });
type Params = { page: number; limit: number; keyword?: string; status?: string };
type Call = { method?: string; path?: string; params?: Params; session: string | null };

async function setup(options: { write?: () => Promise<unknown>; readDetail?: () => Promise<unknown>;
  readList?: (params: Params) => Promise<unknown> } = {}) {
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ username: 'Admin A', admin_id: 1 }));
  const calls: Call[] = [];
  let current = user();
  const adapter: AxiosAdapter = async config => {
    calls.push({ method: config.method, path: config.url, params: config.params, session: localStorage.getItem('admin_session') });
    let data: unknown;
    if (config.method !== 'get') {
      current = { ...current, status: JSON.parse(config.data).status };
      data = options.write ? await options.write() : (() => { throw networkError(); })();
    } else if (config.url === '/admin/users') data = options.readList ? await options.readList(config.params) : list([current]);
    else if (config.url === '/admin/users/1') data = options.readDetail ? await options.readDetail() : detail(current);
    else throw new Error(`Unexpected request: ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<UsersPage />);
  await settle();
  return { calls, view };
}

beforeEach(() => { notifications.error.mockClear(); notifications.success.mockClear(); });
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('admin user status recovery', () => {
  it('links each displayed customer to their detail page and rejects an old session click', async () => {
    await setup();
    const link = screen.getByRole('link', { name: '详情' });
    expect(link).toHaveAttribute('href', '/admin/users/1');
    localStorage.setItem('admin_session', 'admin-b');
    expect(fireEvent.click(link)).toBe(false);
  });

  it('reads the committed state after losing a disable response without sending another write', async () => {
    const { calls } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '禁用' }));
    await settle();
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      'get /admin/users', 'put /admin/users/1/status', 'get /admin/users/1', 'get /admin/users',
    ]);
    expect(screen.getByText('已禁用', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
    expect(notifications.success).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith('已重新加载当前用户状态，请核对后再操作；此前提交结果仍无法确认');
  });

  it('locks writes after a failed verification and retries only the reads once per click group', async () => {
    const pending = deferred();
    let reads = 0;
    const { calls } = await setup({ readDetail: async () => {
      if (++reads === 1) throw networkError();
      if (reads === 2) return pending.promise;
      return detail(user(1, 0));
    } });
    const oldWrite = captureHandler(screen.getByRole('button', { name: '禁用' }));
    void oldWrite(); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('无法确认用户更新结果，请重新读取当前状态后再操作');
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    await oldWrite(); await settle();
    const retry = screen.getByRole('button', { name: '重新读取用户状态' });
    const staleRetry = captureHandler(retry);
    act(() => { retry.click(); retry.click(); }); await settle();
    await staleRetry(); await settle();
    expect(reads).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('用户更新结果未知，正在核对当前状态...');
    await act(async () => pending.resolve(detail(user(1, 0)))); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
    expect(calls.filter(call => call.method === 'put')).toHaveLength(1);
  });

  it.each([400, 403, 404, 422])('treats a server %s response as a definite rejection', async status => {
    const { calls } = await setup({ write: async () => { throw responseError(status); } });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(calls).toHaveLength(2);
    expect(screen.getByRole('button', { name: '禁用' })).toBeEnabled();
    expect(notifications.error).toHaveBeenCalledWith('无权限');
    expect(screen.queryByRole('button', { name: '重新读取用户状态' })).not.toBeInTheDocument();
  });

  it.each([408, 409, 429, 500, 503])('verifies an uncertain server %s failure', async status => {
    const { calls } = await setup({ write: async () => { throw responseError(status); } });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(calls.filter(call => call.method === 'get')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
  });

  it.each([{}, { message: '更新成功', status: 1 }])('verifies an unusable acknowledgement %#', async response => {
    await setup({ write: async () => response });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it.each([{}, detail(user(2)), detail({ ...user(), status: 2 })])('keeps writes locked for an invalid detail snapshot %#', async snapshot => {
    await setup({ readDetail: async () => snapshot });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新读取用户状态' })).toBeEnabled();
  });

  it('keeps writes locked when the verification list is malformed', async () => {
    let reads = 0;
    await setup({ readList: async () => ++reads === 1 ? list() : { users: [user()], pagination: { total: -1 } } });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(screen.getByRole('button', { name: '禁用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新读取用户状态' })).toBeEnabled();
  });

  it('uses the latest filters when a write fails after the list scope changed', async () => {
    const pendingWrite = deferred();
    const { calls } = await setup({ write: () => pendingWrite.promise });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    fireEvent.change(screen.getByRole('combobox', { name: '用户状态' }), { target: { value: '0' } }); await settle();
    await act(async () => pendingWrite.reject(networkError())); await settle();
    expect(calls.at(-1)).toMatchObject({ path: '/admin/users', params: { page: 1, limit: 20, status: '0' } });
    expect(screen.getByRole('combobox', { name: '用户状态' })).toHaveValue('0');
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
  });

  it('leaves an explicit retry when the scope moves during verification instead of looping through reads', async () => {
    const pendingList = deferred();
    let reads = 0;
    const { calls } = await setup({ readList: async params => {
      if (++reads === 2) return pendingList.promise;
      return list([user(1, params.status === '0' ? 0 : 1)]);
    } });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    fireEvent.change(screen.getByRole('combobox', { name: '用户状态' }), { target: { value: '0' } }); await settle();
    await act(async () => pendingList.resolve(list([user(1, 0)]))); await settle();
    expect(reads).toBe(3);
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取用户状态' })); await settle();
    expect(reads).toBe(4);
    expect(calls.at(-1)?.params?.status).toBe('0');
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
  });

  it('keeps the lock and requests an explicit retry when filters change during the detail verification', async () => {
    const pendingDetail = deferred();
    let detailReads = 0;
    const { calls } = await setup({ readDetail: async () => ++detailReads === 1 ? pendingDetail.promise : detail(user(1, 0)) });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    fireEvent.change(screen.getByRole('combobox', { name: '用户状态' }), { target: { value: '0' } }); await settle();
    await act(async () => pendingDetail.resolve(detail(user(1, 0)))); await settle();
    expect(calls.filter(call => call.path === '/admin/users')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取用户状态' })); await settle();
    expect(calls.at(-1)?.params?.status).toBe('0');
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
    expect(calls.filter(call => call.method === 'put')).toHaveLength(1);
  });

  it('does not apply a verification read after unmount or start a list read afterward', async () => {
    const pendingDetail = deferred();
    const { calls, view } = await setup({ readDetail: () => pendingDetail.promise });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(calls).toHaveLength(3);
    view.unmount();
    await act(async () => pendingDetail.resolve(detail(user(1, 0)))); await settle();
    expect(calls).toHaveLength(3);
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('discards the old recovery when another administrator signs in', async () => {
    const pendingWrite = deferred();
    const { calls } = await setup({ write: () => pendingWrite.promise });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    localStorage.setItem('admin_session', 'admin-b');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })));
    await settle();
    await act(async () => pendingWrite.reject(networkError())); await settle();
    expect(calls.filter(call => call.path === '/admin/users/1')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '启用' })).toBeEnabled();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('does not start verification after unmount', async () => {
    const pendingWrite = deferred();
    const { calls, view } = await setup({ write: () => pendingWrite.promise });
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    view.unmount();
    await act(async () => pendingWrite.reject(networkError())); await settle();
    expect(calls).toHaveLength(2);
    expect(notifications.error).not.toHaveBeenCalled();
  });
});
