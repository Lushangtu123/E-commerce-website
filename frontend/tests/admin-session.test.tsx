import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from '@/components/AdminLayout';
import { startAdminSession } from '@/lib/admin-session';
import api, { cartApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { captureHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const pathname = vi.hoisted(() => ({ current: '/admin/logs' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => pathname.current }));

const admin = (username: string, admin_id = 1) => JSON.stringify({ admin_id, username, real_name: null, role_name: '管理员' });
const originalAdapter = api.defaults.adapter;
let requests: InternalAxiosRequestConfig[] = [];

/** Browser storage of a signed-in customer beside the administrator session under test. */
function storage(entries: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ session: 'customer-session', user: '{"user_id":1}', 'ecommerce-locale': 'en-US', ...entries })) {
    localStorage.setItem(key, value);
  }
}

function storageChanged(key: string | null) {
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key })); });
}

function switchAdmin() {
  localStorage.setItem('admin_session', 'second-session');
  localStorage.setItem('admin_user', admin('second', 2));
}

async function renderLayout() {
  const view = render(<AdminLayout>Protected administration</AdminLayout>);
  await settle();
  return view;
}

const redirects = () => [...router.push.mock.calls, ...router.replace.mock.calls].map(([path]) => path);
const logoutButton = () => screen.getByRole('button', { name: /退出登录/ });

beforeEach(() => {
  requests = [];
  pathname.current = '/admin/logs';
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('admin layout session', () => {
  it.each(['{bad', 'null', '[]', '{}', '{"username":{}}', '{"username":""}', '{"username":"valid","real_name":{}}',
    '{"username":"valid","role_name":4}', '{"username":"valid","admin_id":-1}'])('redirects without exposing protected content for stored admin %s', async (admin_user) => {
    storage({ admin_session: 'admin-session', admin_user });

    await renderLayout();

    expect(redirects()).toContain('/admin/login');
    expect(screen.queryByText('Protected administration')).not.toBeInTheDocument();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(localStorage.getItem('ecommerce-locale')).toBe('en-US');
  });

  it('redirects safely when browser storage is denied', async () => {
    storage();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });

    await renderLayout();

    expect(redirects()).toContain('/admin/login');
  });

  it('still renders a valid historical username-only session', async () => {
    storage({ admin_session: 'admin-session', admin_user: '{"username":"legacy","role_name":"管理员"}' });

    await renderLayout();

    expect(screen.getByText('legacy')).toBeInTheDocument();
    expect(screen.getByText('Protected administration')).toBeInTheDocument();
    expect(redirects()).toEqual([]);
  });

  it('follows cross-tab session changes and stops listening after unmount', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    storage({ admin_session: 'first-session', admin_user: admin('first') });
    const view = await renderLayout();
    expect(screen.getByText('first')).toBeInTheDocument();

    switchAdmin();
    storageChanged('admin_user');
    await settle();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();

    localStorage.removeItem('admin_session');
    storageChanged('admin_session');
    await settle();
    expect(screen.queryByText('Protected administration')).not.toBeInTheDocument();
    expect(redirects()).toContain('/admin/login');

    view.unmount();
    const before = redirects().length;
    storageChanged(null);
    expect(redirects()).toHaveLength(before);
    const storageListeners = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'storage').map(([, listener]) => listener);
    expect(storageListeners(removed)).toEqual(expect.arrayContaining(storageListeners(added)));
  });

  it('cannot remove a replacement administrator session through the old logout button', async () => {
    storage({ admin_session: 'first-session', admin_user: admin('first') });
    await renderLayout();

    switchAdmin();
    fireEvent.click(logoutButton());

    expect(localStorage.getItem('admin_session')).toBe('second-session');
    expect(redirects()).toEqual([]);
  });

  it('signs out locally and asks the API to clear the httpOnly administrator cookie', async () => {
    storage({ admin_session: 'first-session', admin_user: admin('first') });
    const adapter: AxiosAdapter = async config => {
      requests.push(config);
      return { data: { message: '已退出登录' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    api.defaults.adapter = adapter;
    await renderLayout();

    fireEvent.click(logoutButton());
    await settle();

    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(requests.map(config => [config.method, config.url, config.withCredentials])).toEqual([['post', '/admin/logout', true]]);
    expect(requests[0].headers.get('Authorization')).toBeUndefined();
    expect(requests[0].headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(new Set(redirects())).toEqual(new Set(['/admin/login']));
  });

  it('still leaves the administration when the logout request fails', async () => {
    storage({ admin_session: 'first-session', admin_user: admin('first') });
    const adapter: AxiosAdapter = async config => {
      requests.push(config);
      throw Object.assign(new Error('Network Error'), { config });
    };
    api.defaults.adapter = adapter;
    await renderLayout();

    fireEvent.click(logoutButton());
    await settle();

    expect(requests).toHaveLength(1);
    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(new Set(redirects())).toEqual(new Set(['/admin/login']));
  });

  it('drops a legacy readable administrator token and asks to sign in again', async () => {
    storage({ admin_token: 'legacy-jwt', admin_user: admin('legacy') });

    await renderLayout();

    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(screen.queryByText('Protected administration')).not.toBeInTheDocument();
    expect(redirects()).toContain('/admin/login');
  });

  it('keeps a cookie session signed in when a legacy token is still stored beside it', async () => {
    storage({ admin_token: 'legacy-jwt', admin_session: 'admin-session', admin_user: admin('current') });

    await renderLayout();

    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(localStorage.getItem('admin_session')).toBe('admin-session');
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText('Protected administration')).toBeInTheDocument();
    expect(redirects()).toEqual([]);
  });

  it('names every administrator sign-in differently so other tabs notice a new one', () => {
    startAdminSession({ username: 'first' });
    const first = localStorage.getItem('admin_session');
    startAdminSession({ username: 'second' });
    const second = localStorage.getItem('admin_session');

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toEqual({ username: 'second' });
  });

  it('lets authenticated administrators navigate to coupon management from the sidebar', async () => {
    storage({ admin_session: 'admin-session', admin_user: JSON.stringify({ username: 'admin', role_name: '管理员' }) });
    pathname.current = '/admin/coupons';

    await renderLayout();

    const links = screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/admin/coupons');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).toHaveTextContent('优惠券管理');
  });

  it.each(['/admin/products/1/skus', '/admin/products-other'])('highlights Products for its SKU subroutes but not for %s-like names', async (path) => {
    storage({ admin_session: 'admin-session', admin_user: JSON.stringify({ admin_id: 1, username: 'owner' }) });
    pathname.current = path;

    await renderLayout();

    const link = screen.getAllByRole('link').find(element => element.getAttribute('href') === '/admin/products')!;
    if (path === '/admin/products/1/skus') expect(link).toHaveAttribute('aria-current', 'page');
    else expect(link).not.toHaveAttribute('aria-current');
  });

  it('cannot clear credentials or navigate from a saved logout handler after unmount', async () => {
    storage({ admin_session: 'first-session', admin_user: admin('first') });
    const view = await renderLayout();
    const logout = captureHandler(logoutButton());

    view.unmount();
    await logout();

    expect(localStorage.getItem('admin_session')).toBe('first-session');
    expect(redirects()).toEqual([]);
  });
});

describe('API client sessions', () => {
  it('preserves the original 401 rejection when storage becomes inaccessible', async () => {
    storage({ admin_session: 'admin-session', admin_user: admin('first') });
    const error = new Error('Unauthorized administrator');
    const adapter: AxiosAdapter = async config => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
      throw Object.assign(error, { config, response: { status: 401 } });
    };
    api.defaults.adapter = adapter;
    const href = window.location.href;

    await expect(api.get('/admin/logs')).rejects.toBe(error);
    expect(window.location.href).toBe(href);
  });

  it('keeps public category reads anonymous when customer storage differs from the hydrated session', async () => {
    storage({ token: 'customer-A', user: '{"user_id":1,"username":"customer","email":"customer@example.test"}', admin_session: 'admin-session', admin_user: admin('administrator') });
    useAuthStore.getState().hydrate();
    localStorage.setItem('session', 'customer-B');
    const adapter: AxiosAdapter = async config => {
      requests.push(config);
      return { data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config };
    };
    api.defaults.adapter = adapter;

    for (const url of ['/products/categories', 'products/categories', 'http://localhost:3001/api/products/categories']) {
      await api.get(url, { headers: { Authorization: 'Bearer supplied-session' } });
      expect(requests.at(-1)?.headers.get('Authorization')).toBeUndefined();
    }
    expect(requests).toHaveLength(3);

    await expect(cartApi.list()).rejects.toThrow(/登录状态已变化/);
    await expect(api.post('/products/categories', {})).rejects.toThrow(/登录状态已变化/);
    expect(requests).toHaveLength(3);
    expect(localStorage.getItem('admin_session')).toBe('admin-session');
  });
});
