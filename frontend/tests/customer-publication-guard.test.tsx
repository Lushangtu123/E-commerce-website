import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/profile/settings/page';
import AppShell from '@/components/AppShell';
import api, { addressApi, browseApi, cartApi, couponApi, favoriteApi, searchApi, userApi, type AuthSession } from '@/lib/api';
import { customerAuthAttempt, CustomerAuthUnconfirmed } from '@/lib/customer-auth-flow';
import { CUSTOMER_CLEANUP_KEY, useAuthStore } from '@/store/useAuthStore';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/settings' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@/components/CartAddRecovery', () => ({ default: () => null }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));

const first = { user_id: 1, username: 'First account', email: 'first@example.test' };
const second = { user_id: 2, username: 'Second account', email: 'second@example.test' };
const replacement = { user_id: 3, username: 'Replacement account', email: 'replacement@example.test' };
const address = { receiver_name: 'First recipient', phone: '+1 555 555 0100', province: 'Province', city: 'City', district: 'District', detail_address: 'First street', is_default: true };
const expectedHeader = 'X-Expected-Customer-Id';
const changed = '登录状态已变化，请刷新后重试';
const originalAdapter = api.defaults.adapter;
let requests: Array<{ route: string; cookieUser: number | null; expectedUser: unknown }>;
let cookieUser: number | null;
let finishPending: Array<() => void>;
let restoreStorage: Array<() => void>;

function serve(answer: (config: InternalAxiosRequestConfig) => unknown | Promise<unknown>) {
  const adapter: AxiosAdapter = async config => {
    requests.push({ route: `${config.method?.toUpperCase()} ${config.url}`, cookieUser, expectedUser: config.headers.get(expectedHeader) });
    const data = await answer(config);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

function signIn(route: 'login' | 'register' = 'login', commit: (data: AuthSession) => void = data => { useAuthStore.getState().login(data.user, 'second-session'); }) {
  const body = deferred<AuthSession>();
  finishPending.push(() => body.resolve({ user: second }));
  serve(config => {
    if (config.url === '/users/logout') { cookieUser = null; return { message: '已退出登录' }; }
    if (config.url === `/users/${route}`) {
      // Response headers can replace the HttpOnly cookie while the JSON body is still arriving.
      cookieUser = second.user_id;
      return body.promise;
    }
    return { user: cookieUser === first.user_id ? first : second };
  });
  const attempt = customerAuthAttempt(() => true, commit);
  const data = { email: second.email, password: 'DisposableFixture123!' };
  const result = route === 'login' ? userApi.login(data, attempt) : userApi.register({ ...data, username: second.username }, attempt);
  return { body, result };
}

beforeEach(() => {
  requests = []; finishPending = []; restoreStorage = []; cookieUser = first.user_id;
  useAuthStore.getState().login(first, 'first-session');
});
afterEach(async () => {
  restoreStorage.forEach(restore => restore());
  finishPending.forEach(finish => finish());
  await settle();
  vi.restoreAllMocks();
  act(() => useAuthStore.getState().logout());
  serve(() => ({ message: '已退出登录' }));
  await userApi.logout();
  api.defaults.adapter = originalAdapter;
});

const protectedCalls: Array<[string, () => Promise<unknown>]> = [
  ['profile read', userApi.getProfile],
  ['profile write', () => userApi.updateProfile({ username: 'First draft', phone: null, avatar_url: null })],
  ['address read', addressApi.list], ['address write', () => addressApi.create(address)],
  ['cart read', cartApi.list], ['cart clear', cartApi.clear],
  ['coupon read', () => couponApi.getMyCoupons()], ['coupon claim', () => couponApi.receive(7)],
  ['favorite read', () => favoriteApi.list()], ['favorite write', () => favoriteApi.add(7)],
  ['search history read', () => searchApi.getHistory()], ['search history clear', searchApi.clearHistory],
  ['browse history read', () => browseApi.getHistory()], ['browse history clear', browseApi.clearHistory],
];

describe('customer cookie publication guard', () => {
  it.each(protectedCalls)('blocks %s before transport while a cooperative sign-in holds the cookie lock', async (_label, call) => {
    let lockHeld = false;
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => {
      lockHeld = true; try { return await run(); } finally { lockHeld = false; }
    } } });
    const pending = signIn();
    await settle();
    try {
      expect(lockHeld).toBe(true);
      expect(cookieUser).toBe(second.user_id);
      expect(useAuthStore.getState().user?.user_id).toBe(first.user_id);
      expect(localStorage.getItem(CUSTOMER_CLEANUP_KEY)).toBe('1');
      await expect(Promise.resolve().then(call)).rejects.toThrow(changed);
      expect(requests.map(request => request.route)).toEqual(['POST /users/login']);
    } finally { pending.body.resolve({ user: second }); await pending.result; }
    await call();
    expect(requests.at(-1)).toMatchObject({ cookieUser: second.user_id, expectedUser: '2' });
  });

  it.each(['login', 'register'] as const)('keeps the marker through the %s publication callback', async route => {
    let markerDuringCommit: string | null = null;
    const pending = signIn(route, data => {
      markerDuringCommit = localStorage.getItem(CUSTOMER_CLEANUP_KEY);
      useAuthStore.getState().login(data.user, 'second-session');
    });
    pending.body.resolve({ user: second }); await pending.result;
    expect(markerDuringCommit).toBe('1');
    expect(localStorage.getItem(CUSTOMER_CLEANUP_KEY)).toBeNull();
    expect(requests[0]).toMatchObject({ route: `POST /users/${route}`, expectedUser: undefined });
    await userApi.getProfile();
    expect(requests.at(-1)?.expectedUser).toBe('2');
  });

  it('blocks the real profile Save after the cookie changes while retaining a normal first-account control', async () => {
    const changedUsers: number[] = [];
    serve(config => {
      if (config.method === 'put') changedUsers.push(cookieUser!);
      return { user: config.method === 'put' ? { ...first, ...JSON.parse(config.data) } : first };
    });
    render(<SettingsPage />); await settle();
    const input = screen.getByLabelText('用户名');
    fireEvent.change(input, { target: { value: 'Normal first save' } });
    fireEvent.submit(input.closest('form')!); await settle();
    expect(changedUsers).toEqual([first.user_id]);
    expect(requests.at(-1)).toMatchObject({ cookieUser: first.user_id, expectedUser: '1' });
    fireEvent.change(input, { target: { value: 'First draft intended for first account' } });
    const pending = signIn(); await settle();
    fireEvent.submit(input.closest('form')!); await settle();
    expect(requests.filter(request => request.route === 'PUT /users/profile')).toHaveLength(1);
    expect(useAuthStore.getState().user?.user_id).toBe(first.user_id);
    pending.body.resolve({ user: second }); await act(async () => { await pending.result; });
  });

  it.each(['get', 'put'] as const)('binds a normal protected %s to the hydrated customer and removes forged overrides', async method => {
    serve(() => ({}));
    await api.request({ method, url: '/users/profile', headers: { 'x-expected-customer-id': '999' } });
    expect(requests).toEqual([{ route: `${method.toUpperCase()} /users/profile`, cookieUser: first.user_id, expectedUser: '1' }]);
  });

  it('captures the expected customer before transport attaches a subsequently replaced cookie', async () => {
    const gate = deferred<void>();
    let expectedUser: unknown;
    api.defaults.adapter = async config => {
      expectedUser = config.headers.get(expectedHeader);
      await gate.promise;
      expect(cookieUser).toBe(second.user_id);
      throw new AxiosError(changed, AxiosError.ERR_BAD_REQUEST, config, undefined,
        { config, data: { error: changed }, status: 409, statusText: 'Conflict', headers: {} });
    };
    const request = userApi.updateProfile({ username: 'First draft', phone: null, avatar_url: null });
    const rejected = expect(request).rejects.toMatchObject({ response: { status: 409 } });
    act(() => { cookieUser = second.user_id; useAuthStore.getState().login(second, 'second-session'); });
    gate.resolve(); await rejected;
    expect(expectedUser).toBe('1');
    expect(useAuthStore.getState().user).toEqual(second);
    expect(localStorage.getItem('session')).toBe('second-session');
  });

  it.each(['/products', '/products/hot', '/products/7', '/products/categories', '/reviews/product/7', '/search/hot', '/search/suggestions', '/recommendations/related/7', '/payments/settings', '/users/password/capabilities'])
    ('keeps public GET %s available without storage or an expected-user header', async url => {
      localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
      serve(() => ({}));
      const storage = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError'); });
      restoreStorage.push(() => storage.mockRestore());
      await api.get(url, { headers: { [expectedHeader]: '999' } });
      expect(requests[0].expectedUser).toBeUndefined();
    });

  it.each([
    ['get', '/admin/products'], ['post', '/admin/login'], ['post', '/users/login'], ['post', '/users/register'],
    ['post', '/users/logout'], ['post', '/users/password/forgot'], ['post', '/users/password/reset'],
  ])('keeps %s %s outside the customer guard and removes a supplied expected-user header', async (method, url) => {
    localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
    serve(() => ({}));
    await api.request({ method, url, headers: { [expectedHeader]: '999' } });
    expect(requests[0].expectedUser).toBeUndefined();
  });

  it('blocks a durable pending marker after reload without depending on this tab owning the queue', async () => {
    localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
    serve(() => ({}));
    await expect(userApi.getProfile()).rejects.toThrow(changed);
    expect(requests).toEqual([]);
  });

  it('allows explicit cleanup and a later sign-in to recover a durable marker', async () => {
    localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
    const pending = signIn(); await settle();
    pending.body.resolve({ user: second }); await pending.result;
    await userApi.getProfile();
    expect(requests.map(request => request.route)).toEqual(['POST /users/logout', 'POST /users/login', 'GET /users/profile']);
    expect(requests.at(-1)?.expectedUser).toBe('2');
  });

  it('keeps protected requests blocked after logout cleanup fails but lets explicit logout recover', async () => {
    serve(() => { throw new Error('Cleanup unavailable'); });
    await expect(userApi.logout()).rejects.toThrow('Cleanup unavailable');
    await expect(userApi.getProfile()).rejects.toThrow(changed);
    expect(requests.map(request => request.route)).toEqual(['POST /users/logout']);
    serve(() => ({ message: '已退出登录' }));
    await userApi.logout();
    expect(localStorage.getItem(CUSTOMER_CLEANUP_KEY)).toBeNull();
  });

  it('keeps normal password and reset requests in their existing queues without inheriting a caller header', async () => {
    serve(() => ({ reauthenticate: true }));
    await userApi.changePassword({ currentPassword: 'DisposableOriginal123!', newPassword: 'DisposableUpdated456!' });
    await userApi.resetPassword({ token: 'a'.repeat(64), newPassword: 'DisposableReset789!' });
    expect(requests).toEqual([
      { route: 'PUT /users/password', cookieUser: first.user_id, expectedUser: '1' },
      { route: 'POST /users/password/reset', cookieUser: first.user_id, expectedUser: undefined },
    ]);
  });

  it('follows both marker events so another tab cannot hydrate an unfinished publication or remain signed out after it completes', async () => {
    render(<AppShell>page</AppShell>); await settle();
    localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
    act(() => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: CUSTOMER_CLEANUP_KEY })));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    localStorage.setItem('session', 'second-session'); localStorage.setItem('user', JSON.stringify(second));
    act(() => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: 'session' })));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    localStorage.removeItem(CUSTOMER_CLEANUP_KEY);
    act(() => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: CUSTOMER_CLEANUP_KEY })));
    expect(useAuthStore.getState()).toMatchObject({ sessionId: 'second-session', user: second, isAuthenticated: true });
  });

  it('forgets its newly published session if removing its pending marker fails', async () => {
    const remove = localStorage.removeItem.bind(localStorage);
    const storage = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
      if (key === CUSTOMER_CLEANUP_KEY) throw new DOMException('Storage denied', 'SecurityError');
      remove(key);
    });
    restoreStorage.push(() => storage.mockRestore());
    let published = false;
    const pending = signIn('login', data => { useAuthStore.getState().login(data.user, 'second-session'); published = true; });
    pending.body.resolve({ user: second });
    await expect(pending.result).rejects.toBeInstanceOf(CustomerAuthUnconfirmed);
    expect(published).toBe(true);
    expect(cookieUser).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('session')).toBeNull();
    expect(localStorage.getItem(CUSTOMER_CLEANUP_KEY)).toBe('1');
  });

  it('preserves a replacement session during cleanup of a failed publication', async () => {
    const pending = signIn('login', () => { throw new Error('Publication failed'); });
    // Replace only the response handling; the sign-in is already awaiting its body.
    serve(config => {
      if (config.url === '/users/logout') { cookieUser = null; useAuthStore.getState().login(replacement, 'replacement-session'); return { message: '已退出登录' }; }
      return {};
    });
    pending.body.resolve({ user: second });
    await expect(pending.result).rejects.toBeInstanceOf(CustomerAuthUnconfirmed);
    expect(useAuthStore.getState()).toMatchObject({ user: replacement, sessionId: 'replacement-session' });
    expect(localStorage.getItem('session')).toBe('replacement-session');
  });
});
