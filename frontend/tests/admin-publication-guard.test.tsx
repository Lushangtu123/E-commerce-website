import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '@/app/admin/users/page';
import api, { adminApi, adminCouponApi, adminSKUApi, userApi } from '@/lib/api';
import { adminAuthAttempt, adminSessionLogout, AdminAuthUnconfirmed, type AdminAuthResult } from '@/lib/admin-auth-flow';
import { getAdminSession, startAdminSession } from '@/lib/admin-session';
import { useAuthStore } from '@/store/useAuthStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/users' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const first = { admin_id: 1, username: 'First administrator', role_name: 'super_admin' };
const second = { admin_id: 2, username: 'Second administrator', role_name: 'super_admin' };
const replacement = { admin_id: 3, username: 'Replacement administrator' };
const cleanupKey = 'admin_session_cleanup_pending', expectedHeader = 'X-Expected-Admin-Id';
const changed = '登录状态已变化，请刷新后重试';
const customer = { user_id: 8, username: 'Shopper', email: 'shopper@example.test' };
const buyer = { user_id: 10, username: 'Buyer', email: 'buyer@example.test', phone: null, status: 1, created_at: '2026-10-08T00:00:00Z' };
const original = api.defaults.adapter;
let calls: Array<{ route: string; owner: number | null; expected: unknown; customer: unknown }>;
let cookieOwner: number | null;
let finish: Array<() => void>, restore: Array<() => void>;
function serve(answer: (config: InternalAxiosRequestConfig) => unknown = () => ({})) {
  api.defaults.adapter = async config => {
    calls.push({ route: `${config.method?.toUpperCase()} ${config.url}`, owner: cookieOwner, expected: config.headers.get(expectedHeader), customer: config.headers.get('X-Expected-Customer-Id') });
    return { config, status: 200, statusText: 'OK', headers: {}, data: await answer(config) };
  };
}
function signIn(commit: (value: AdminAuthResult) => void = value => { startAdminSession(value.admin); }) {
  const gate = deferred<{ admin: typeof second }>();
  finish.push(() => gate.resolve({ admin: second }));
  const fetch = vi.fn(async () => {
    cookieOwner = second.admin_id;
    return { ok: true, status: 200, json: () => gate.promise } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  const result = adminApi.login({ username: second.username, password: 'DisposableFixture123!' }, adminAuthAttempt(() => true, commit));
  return { gate, result, fetch };
}
beforeEach(() => {
  calls = []; finish = []; restore = []; cookieOwner = first.admin_id;
  startAdminSession(first); serve();
});
afterEach(async () => {
  restore.forEach(run => run()); finish.forEach(run => run()); await settle();
  await adminSessionLogout(async () => ({ message: '已退出登录' }));
  api.defaults.adapter = original;
});
const storage = (key: string) => act(() => window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage })));
const protectedCalls: Array<[string, () => Promise<unknown>]> = [
  ['profile', () => api.get('/admin/profile')], ['users', () => api.get('/admin/users')],
  ['user status', () => api.put('/admin/users/10/status', { status: 0 })],
  ['product creation', () => api.post('/admin/products', {})], ['product edit', () => api.put('/admin/products/1', {})],
  ['product status', () => api.put('/admin/products/1/status', { status: 0 })],
  ['SKU list', () => adminSKUApi.list(1)], ['SKU edit', () => adminSKUApi.update(1, 1, { stock: 5 })],
  ['coupon status', () => adminCouponApi.updateStatus(1, 0)],
  ['order status', () => api.put('/admin/orders/1/status', { status: 3 })],
  ['after-sales', () => api.post('/admin/after-sales/1/review', { status: 'approved', note: 'Fixture' })],
];

describe('administrator publication guard', () => {
  it.each(protectedCalls)('blocks %s while B cookie arrives before B profile publication', async (_name, call) => {
    const pending = signIn(); await settle();
    try {
      expect(localStorage.getItem(cleanupKey)).toBe('1');
      expect(getAdminSession()?.admin.admin_id).toBe(first.admin_id);
      expect(cookieOwner).toBe(second.admin_id);
      await expect(Promise.resolve().then(call)).rejects.toThrow(changed);
      expect(calls).toEqual([]);
    } finally { pending.gate.resolve({ admin: second }); await pending.result; }
    await call(); expect(calls.at(-1)).toMatchObject({ owner: 2, expected: '2', customer: undefined });
  });

  it('keeps the marker through identity publication and recovers normal B reads', async () => {
    let during: string | null = null;
    const pending = signIn(value => { during = localStorage.getItem(cleanupKey); startAdminSession(value.admin); });
    pending.gate.resolve({ admin: second }); await pending.result;
    expect(during).toBe('1'); expect(localStorage.getItem(cleanupKey)).toBeNull();
    await api.get('/admin/profile'); expect(calls.at(-1)?.expected).toBe('2');
  });

  it.each(['GET', 'PUT'])('binds %s to the validated administrator profile and strips caller overrides', async method => {
    await api.request({ method, url: '/admin/users', headers: { 'x-expected-admin-id': '999', 'X-Expected-Customer-Id': '999' } });
    expect(calls.at(-1)).toMatchObject({ expected: '1', customer: undefined });
  });

  it('captures A context before the transport subsequently receives B cookie', async () => {
    const gate = deferred<void>(); let expected: unknown;
    api.defaults.adapter = async config => {
      expected = config.headers.get(expectedHeader); await gate.promise;
      throw new AxiosError(changed, AxiosError.ERR_BAD_REQUEST, config, undefined, { config, status: 409, statusText: 'Conflict', headers: {}, data: { error: changed } });
    };
    const write = api.put('/admin/users/10/status', { status: 0 });
    const rejected = expect(write).rejects.toMatchObject({ response: { status: 409 } });
    cookieOwner = second.admin_id; startAdminSession(second); const id = getAdminSession()?.sessionId;
    gate.resolve(); await rejected;
    expect(expected).toBe('1'); expect(getAdminSession()).toMatchObject({ sessionId: id, admin: second });
  });

  it('blocks a real A row handler even if the marker storage event is delayed', async () => {
    serve(config => config.method === 'put' ? { message: '更新成功', status: 0 } : { users: [buyer], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    render(<UsersPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '禁用' })); await settle();
    expect(calls.filter(call => call.route.startsWith('PUT'))).toHaveLength(1);
    expect(calls.find(call => call.route.startsWith('PUT'))?.expected).toBe('1');
    const stale = captureHandler(screen.getByRole('button', { name: '禁用' }));
    const pending = signIn(); await settle();
    await stale(); await settle();
    expect(calls.filter(call => call.route.startsWith('PUT'))).toHaveLength(1);
    pending.gate.resolve({ admin: second }); await act(async () => { await pending.result; }); await settle();
    await stale(); expect(calls.filter(call => call.route.startsWith('PUT'))).toHaveLength(1);
  });

  it('hides old content across both marker events and mixed identity publication events', async () => {
    serve(() => ({ users: [buyer], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }));
    render(<UsersPage />); await settle(); expect(screen.getByText(first.username)).toBeInTheDocument();
    calls = []; localStorage.setItem(cleanupKey, '1'); storage(cleanupKey); await settle();
    expect(screen.queryByRole('button', { name: '禁用' })).toBeNull();
    localStorage.setItem('admin_session', 'second-session'); storage('admin_session'); await settle();
    expect(screen.queryByText(first.username)).toBeNull(); expect(calls).toEqual([]);
    localStorage.setItem('admin_user', JSON.stringify(second)); storage('admin_user'); await settle();
    expect(screen.queryByRole('button', { name: '禁用' })).toBeNull(); expect(calls).toEqual([]);
    localStorage.removeItem(cleanupKey); storage(cleanupKey); await settle();
    expect(screen.getByText(second.username)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '禁用' })).toBeEnabled();
    expect(calls).toHaveLength(1); expect(calls[0].expected).toBe('2');
  });

  it('restores A content after an unrelated sign-in rejects and removes the pending marker', async () => {
    serve(() => ({ users: [buyer], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }));
    render(<UsersPage />); await settle();
    localStorage.setItem(cleanupKey, '1'); storage(cleanupKey); await settle(); expect(screen.queryByText(first.username)).toBeNull();
    localStorage.removeItem(cleanupKey); storage(cleanupKey); await settle();
    expect(screen.getByText(first.username)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '禁用' })).toBeEnabled();
  });

  it.each([undefined, 0, -1, 1.5, '2', 9007199254740992])('preserves safe compatibility for old/unusable stored admin ID %p', async adminId => {
    localStorage.setItem('admin_user', JSON.stringify({ username: 'Legacy', ...(adminId !== undefined && { admin_id: adminId }) }));
    await api.get('/admin/profile', { headers: { [expectedHeader]: '999' } }); expect(calls.at(-1)?.expected).toBeUndefined();
    localStorage.setItem(cleanupKey, '1'); await expect(api.get('/admin/profile')).rejects.toThrow(changed);
  });

  it('lets logout reconcile a durable marker and strips admin context on login/logout', async () => {
    localStorage.setItem(cleanupKey, '1'); serve(() => ({ message: '已退出登录' }));
    await api.post('/admin/login', {}, { headers: { [expectedHeader]: '999' } });
    await adminApi.logout();
    expect(calls.map(call => [call.route, call.expected])).toEqual([['POST /admin/login', undefined], ['POST /admin/logout', undefined]]);
    expect(localStorage.getItem(cleanupKey)).toBeNull();
  });

  it('keeps all protected requests blocked until failed cookie cleanup is acknowledged', async () => {
    serve(() => { throw new Error('Cleanup unavailable'); });
    await expect(adminApi.logout()).rejects.toThrow('Cleanup unavailable');
    await expect(api.get('/admin/profile')).rejects.toThrow(changed); expect(calls).toHaveLength(1);
    serve(() => ({ message: '已退出登录' })); await adminApi.logout();
    await api.get('/admin/profile'); expect(calls.at(-1)?.expected).toBe('1');
  });

  it('retires its own successfully published profile when final marker clearing fails', async () => {
    const remove = localStorage.removeItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => { if (key === cleanupKey) throw new DOMException('Storage disabled', 'SecurityError'); remove(key); }); restore.push(() => spy.mockRestore());
    serve(() => ({ message: '已退出登录' })); const pending = signIn(); const rejected = expect(pending.result).rejects.toBeInstanceOf(AdminAuthUnconfirmed);
    pending.gate.resolve({ admin: second }); await rejected;
    expect(getAdminSession()).toBeNull(); expect(localStorage.getItem(cleanupKey)).toBe('1');
    expect(calls.map(call => call.route)).toEqual(['POST /admin/logout']);
  });

  it('does not clear a replacement installed during publication-failure cleanup', async () => {
    const remove = localStorage.removeItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => { if (key === cleanupKey) throw new DOMException('Storage disabled', 'SecurityError'); remove(key); }); restore.push(() => spy.mockRestore());
    serve(() => { startAdminSession(replacement); return { message: '已退出登录' }; });
    const pending = signIn(); const rejected = expect(pending.result).rejects.toBeInstanceOf(AdminAuthUnconfirmed);
    pending.gate.resolve({ admin: second }); await rejected;
    expect(getAdminSession()?.admin).toEqual(replacement); expect(localStorage.getItem(cleanupKey)).toBe('1');
  });

  it('separates administrator cleanup and context from normal customer requests', async () => {
    useAuthStore.getState().login(customer, 'customer-session'); localStorage.setItem(cleanupKey, '1');
    await userApi.getProfile(); expect(calls.at(-1)).toMatchObject({ expected: undefined, customer: '8' });
    localStorage.removeItem(cleanupKey); localStorage.setItem('customer_session_cleanup_pending', '1');
    await api.get('/admin/profile'); expect(calls.at(-1)).toMatchObject({ expected: '1', customer: undefined });
  });
});
