import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from '@/components/AdminLayout';
import AdminLogin from '@/app/admin/login/page';
import api from '@/lib/api';
import { getAdminSession, startAdminSession } from '@/lib/admin-session';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle, deferred, submitTogether } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/dashboard' }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const admin = { admin_id: 1, username: 'Fixture admin', role_name: 'super_admin' };
const reply = (value: unknown = { admin }, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value }) as Response;
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const form = () => document.querySelector('form')!;
function prepareLogin(request: () => Promise<Response> = async () => reply()) {
  const fetch = vi.fn(request); vi.stubGlobal('fetch', fetch);
  const view = render(<AdminLogin />);
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: admin.username } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'fixture-password' } });
  return { fetch, view };
}
function cleanupRequests(handler: () => Promise<unknown> = async () => ({ message: '已退出登录' })) {
  const clear = vi.fn(handler);
  api.defaults.adapter = async config => ({ status: 200, statusText: 'OK', headers: {}, config, data: await clear() });
  return clear;
}

describe('administrator cookie write ordering', () => {
  it('waits for logout across navigation before sending the next login', async () => {
    startAdminSession(admin);
    const gate = deferred(); const clear = cleanupRequests(() => gate.promise);
    const layout = render(<AdminLayout>Protected administration</AdminLayout>); await settle();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' })); await settle(); layout.unmount();
    const login = prepareLogin();
    fireEvent.submit(form()); await settle();
    try {
      expect(clear).toHaveBeenCalledTimes(1);
      expect(login.fetch).not.toHaveBeenCalled();
      expect(localStorage.getItem('admin_session')).toBeNull();
    } finally { await act(async () => gate.resolve({ message: '已退出登录' })); await settle(); }
    expect(login.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toMatchObject(admin);
    expect(router.push).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('makes duplicate submissions exclusive before React updates the disabled button', async () => {
    const gate = deferred<Response>(); const login = prepareLogin(() => gate.promise);
    submitTogether(form(), form()); await settle();
    try { expect(login.fetch).toHaveBeenCalledTimes(1); }
    finally { await act(async () => gate.resolve(reply())); await settle(); }
  });

  it('cleans an unmounted login response without publishing its profile or navigation', async () => {
    const gate = deferred<Response>(); const clear = cleanupRequests(); const login = prepareLogin(() => gate.promise);
    fireEvent.submit(form()); await settle(); login.view.unmount();
    await act(async () => gate.resolve(reply())); await settle();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });

  it('cleans an abandoned login before a later page publishes its own session', async () => {
    const gate = deferred<Response>(); const clear = cleanupRequests(); const first = prepareLogin(() => gate.promise);
    fireEvent.submit(form()); await settle(); first.view.unmount();
    const secondAdmin = { ...admin, admin_id: 2, username: 'Second administrator' };
    const second = prepareLogin(async () => reply({ admin: secondAdmin })); fireEvent.submit(form()); await settle();
    try { expect(second.fetch).not.toHaveBeenCalled(); }
    finally { await act(async () => gate.resolve(reply())); await settle(); }
    expect(clear).toHaveBeenCalledTimes(1); expect(second.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toMatchObject(secondAdmin);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('cleans a lost login response once without automatically resending credentials', async () => {
    const clear = cleanupRequests(); const login = prepareLogin(async () => { throw new TypeError('Response lost'); });
    fireEvent.submit(form()); await settle();
    expect(login.fetch).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('管理员登录结果尚未确认，请重新登录');
  });

  it('blocks credentials until saved cleanup from an earlier page succeeds', async () => {
    localStorage.setItem('admin_session_cleanup_pending', '1');
    let unavailable = true;
    const clear = cleanupRequests(async () => { if (unavailable) throw new Error('Cleanup unavailable'); return { message: '已退出登录' }; });
    const login = prepareLogin(); fireEvent.submit(form()); await settle();
    try {
      expect(login.fetch).not.toHaveBeenCalled(); expect(clear).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('admin_session_cleanup_pending')).toBe('1');
      expect(toast.error).toHaveBeenCalledWith('管理员会话清理尚未确认，请重试登录');
    } finally { unavailable = false; fireEvent.submit(form()); await settle(); }
    expect(clear).toHaveBeenCalledTimes(2); expect(login.fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session_cleanup_pending')).toBeNull();
  });

  it.each([{ admin: {} }, { admin: [] }, { admin: { username: 'Fixture admin' } }, { admin: { ...admin, admin_id: -1 } }])('cleans an incomplete successful login %j', async value => {
    const clear = cleanupRequests(); prepareLogin(async () => reply(value)); fireEvent.submit(form()); await settle();
    expect(clear).toHaveBeenCalledTimes(1); expect(localStorage.getItem('admin_session')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });

  it('uses the administrator Web Lock before sending credentials', async () => {
    const gate = deferred();
    const request = vi.fn(async (_name: string, run: () => Promise<unknown>) => { await gate.promise; return run(); });
    vi.spyOn(navigator, 'locks', 'get').mockReturnValue({ request } as unknown as LockManager);
    const login = prepareLogin(); fireEvent.submit(form()); await settle();
    try { expect(request.mock.calls[0]?.[0]).toBe('admin-session-cookie'); expect(login.fetch).not.toHaveBeenCalled(); }
    finally { await act(async () => gate.resolve({})); await settle(); }
    expect(login.fetch).toHaveBeenCalledTimes(1);
  });

  it('records an unfinished login before its request so a reload must clean the cookie first', async () => {
    const gate = deferred<Response>(); const login = prepareLogin(() => gate.promise);
    fireEvent.submit(form()); await settle();
    try { expect(localStorage.getItem('admin_session_cleanup_pending')).toBe('1'); }
    finally { await act(async () => gate.resolve(reply())); await settle(); }
    expect(localStorage.getItem('admin_session_cleanup_pending')).toBeNull();
    expect(login.fetch).toHaveBeenCalledTimes(1);
  });

  it('never publishes a late login over a replacement administrator session', async () => {
    const gate = deferred<Response>(); const clear = cleanupRequests(); prepareLogin(() => gate.promise);
    fireEvent.submit(form()); await settle();
    startAdminSession({ admin_id: 2, username: 'Replacement administrator' });
    const replacement = localStorage.getItem('admin_session');
    await act(async () => gate.resolve(reply())); await settle();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session')).toBe(replacement);
    expect(JSON.parse(localStorage.getItem('admin_user')!).admin_id).toBe(2);
    expect(toast.success).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });

  it('reports unknown login cleanup in English after the locale changes', async () => {
    const gate = deferred<Response>(); cleanupRequests(); prepareLogin(() => gate.promise);
    fireEvent.submit(form()); await settle();
    act(() => useLocaleStore.getState().setLocale('en'));
    await act(async () => gate.reject(new TypeError('Lost reply'))); await settle();
    expect(toast.error).toHaveBeenCalledWith('The administrator sign-in result is unconfirmed. Please sign in again.');
  });

  it('preserves a newer profile after a delayed 401 from abandoned-login cleanup', async () => {
    const answer = deferred<Response>(), cleanup = deferred();
    api.defaults.adapter = async config => {
      await cleanup.promise;
      throw new AxiosError('Unauthorized cleanup', AxiosError.ERR_BAD_RESPONSE, config, undefined,
        { config, status: 401, statusText: 'Unauthorized', headers: {}, data: { error: '未认证' } });
    };
    const first = prepareLogin(() => answer.promise); fireEvent.submit(form()); await settle(); first.view.unmount();
    await act(async () => answer.resolve(reply())); await settle();
    const replacement = { admin_id: 2, username: 'Replacement administrator' };
    startAdminSession(replacement); const sessionId = localStorage.getItem('admin_session');
    await act(async () => cleanup.resolve({})); await settle();
    expect(localStorage.getItem('admin_session')).toBe(sessionId);
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toMatchObject(replacement);
    expect(toast.success).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
    expect(localStorage.getItem('admin_session_cleanup_pending')).toBe('1');
    cleanupRequests(); const next = prepareLogin(async () => reply({ admin: replacement }));
    fireEvent.submit(form()); await settle(); expect(next.fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session_cleanup_pending')).toBeNull();
  });

  it('does not send credentials when storage cannot safely record the sign-in', async () => {
    const clear = cleanupRequests(); const login = prepareLogin();
    const storage = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    fireEvent.submit(form()); await settle();
    expect(login.fetch).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('管理员会话清理尚未确认，请重试登录');
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
    storage.mockRestore(); fireEvent.submit(form()); await settle();
    expect(login.fetch).toHaveBeenCalledTimes(1); expect(clear).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('登录成功');
  });

  it.each([false, true])('retires its own partially stored profile and reports the failed publication (previous session: %s)', async previous => {
    if (previous) startAdminSession({ admin_id: 2, username: 'Earlier administrator' });
    const clear = cleanupRequests(); const login = prepareLogin();
    const save = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'admin_user') throw new DOMException('Quota exhausted', 'QuotaExceededError');
      save(key, value);
    });
    fireEvent.submit(form()); await settle();
    expect(login.fetch).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session')).toBeNull(); expect(getAdminSession()).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('管理员登录结果尚未确认，请重新登录');
    expect(toast.success).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
  });

  it('cannot retire another session installed during a failed profile publication', async () => {
    startAdminSession({ admin_id: 2, username: 'Earlier administrator' });
    const clear = cleanupRequests(); prepareLogin();
    const replacement = { admin_id: 3, username: 'Concurrent administrator' };
    const save = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'admin_user') {
        save('admin_session', 'concurrent-session'); save('admin_user', JSON.stringify(replacement));
        throw new DOMException('Quota exhausted', 'QuotaExceededError');
      }
      save(key, value);
    });
    fireEvent.submit(form()); await settle();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('admin_session')).toBe('concurrent-session');
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toEqual(replacement);
    expect(toast.error).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
