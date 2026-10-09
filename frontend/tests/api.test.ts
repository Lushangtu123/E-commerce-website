import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './helpers';

type Storage = Record<string, string>;

/**
 * Loads a fresh API client against `storage`, the way a page load would: storage first, then
 * the auth store hydrates, then the client reads NEXT_PUBLIC_API_URL. Every request is
 * recorded and answered with an empty list unless the test swaps the adapter.
 */
async function setupApi(storage: Storage, apiUrl = 'http://localhost:3001/api') {
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiUrl);
  vi.resetModules();
  const entries = { ...storage };
  if (entries.session && !Object.hasOwn(entries, 'user')) entries.user = '{"user_id":1,"username":"customer","email":"customer@example.test"}';
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  const { useAuthStore } = await import('@/store/useAuthStore');
  useAuthStore.getState().hydrate();
  const client = await import('@/lib/api');
  const requests: InternalAxiosRequestConfig[] = [];
  const respond: AxiosAdapter = async config => {
    requests.push(config);
    const data = config.method === 'post' && ['/users/login', '/users/register'].includes(config.url || '')
      ? { user: { user_id: 1, username: 'customer', email: 'customer@example.test' } } : { data: [] };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  client.default.defaults.adapter = respond;
  const fail = (status: number, message = 'Request failed') => {
    const adapter: AxiosAdapter = async config => {
      requests.push(config);
      throw Object.assign(new Error(message), { config, response: { status } });
    };
    client.default.defaults.adapter = adapter;
  };
  return { ...client, api: client.default, useAuthStore, requests, fail };
}

const authorization = (config: InternalAxiosRequestConfig) => config.headers.get('Authorization');
/** How a request authenticates: customers by the httpOnly cookie plus the CSRF header, never a token. */
const credentials = (config: InternalAxiosRequestConfig) =>
  ({ authorization: authorization(config), cookie: config.withCredentials, csrf: config.headers.get('X-Requested-With') });
const asCustomer = { authorization: undefined, cookie: true, csrf: 'XMLHttpRequest' };
/** Administrators authenticate the same way, by their own httpOnly cookie. */
const asAdmin = asCustomer;
const both = { session: 'customer-session', admin_session: 'admin-session' };

describe('API client requests', () => {
  it('reads profile statistics as the signed-in customer and returns the server counters', async () => {
    const { userApi, api, requests } = await setupApi(both);
    const stats = { totalOrders: 17, pendingOrders: 3, totalCoupons: 11, availableCoupons: 4, favoriteCount: 8 };
    const adapter: AxiosAdapter = async config => {
      requests.push(config);
      return { data: { stats }, status: 200, statusText: 'OK', headers: {}, config };
    };
    api.defaults.adapter = adapter;

    expect(await userApi.getStats()).toEqual({ stats });
    expect(requests[0]).toMatchObject({ method: 'get', url: '/users/stats' });
    expect(requests[0].params).toBeUndefined();
    expect(requests[0].data).toBeUndefined();
    expect(credentials(requests[0])).toEqual(asCustomer);
  });

  it('sends full address fields with customer credentials and separate resource IDs', async () => {
    const { addressApi, requests } = await setupApi(both);
    const body = { receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: true };

    await addressApi.list();
    await addressApi.create(body);
    await addressApi.update(41, body);
    await addressApi.remove(41);

    expect(requests.map(config => [config.method, config.url])).toEqual([['get', '/addresses'], ['post', '/addresses'], ['put', '/addresses/41'], ['delete', '/addresses/41']]);
    expect(JSON.parse(requests[1].data)).toEqual(body);
    expect(JSON.parse(requests[2].data)).toEqual(body);
    for (const config of requests) expect(credentials(config)).toEqual(asCustomer);
  });

  it('targets a SKU when removing a variant and only the base row without one', async () => {
    const { cartApi, requests } = await setupApi({ session: 'customer-session' });

    await cartApi.remove(12, 101);
    await cartApi.remove(12);
    await cartApi.add({ product_id: 12, quantity: 2, sku_id: 101 });
    await cartApi.updateQuantity({ product_id: 12, quantity: 3, sku_id: 102 });

    expect(requests[0].params?.sku_id).toBe(101);
    expect(requests[1].params?.sku_id).toBeUndefined();
    expect(JSON.parse(requests[2].data)).toEqual({ product_id: 12, quantity: 2, sku_id: 101 });
    expect(JSON.parse(requests[3].data)).toEqual({ product_id: 12, quantity: 3, sku_id: 102 });
  });

  it('sends admin coupon requests by cookie, without a token, when both identities are signed in', async () => {
    const { adminCouponApi, requests } = await setupApi(both);

    await adminCouponApi.getList(2, 50, 1);

    expect(credentials(requests[0])).toEqual(asAdmin);
    expect(requests[0].params).toEqual({ page: 2, page_size: 50, status: 1 });
  });

  it("keeps a customer request's cookie session, body, params and response", async () => {
    const { cartApi, couponApi, requests } = await setupApi(both);

    await cartApi.add({ product_id: 12, quantity: 3 });
    const result = await couponApi.getMyCoupons(1);

    expect(credentials(requests[0])).toEqual(asCustomer);
    expect(JSON.parse(requests[0].data)).toEqual({ product_id: 12, quantity: 3 });
    expect(credentials(requests[1])).toEqual(asCustomer);
    expect(requests[1].params.status).toBe(1);
    expect(result).toEqual({ data: [] });
  });

  it.each([
    ['customer', { session: 'customer-session' }, '/admin/coupons', 'Authorization'],
    ['customer', { session: 'customer-session' }, '/admin/coupons', 'authorization'],
    ['admin', { admin_session: 'admin-session' }, '/coupons/my/list', 'Authorization'],
    ['admin', { admin_session: 'admin-session' }, '/coupons/my/list', 'authorization'],
  ] as [string, Storage, string, string][])('with only a %s session, never falls back to it for %s or keeps a supplied %s header', async (_, storage, url, header) => {
    const { api, requests } = await setupApi(storage);

    await api.get(url, { headers: { [header]: 'Bearer other-identity' } });

    expect(authorization(requests[0])).toBeUndefined();
  });

  it('uses admin credentials for absolute and relative admin URLs and customer ones for lookalike paths', async () => {
    const { api, requests } = await setupApi(both);

    await api.get('http://localhost:3001/api/admin/coupons');
    await api.get('admin/coupons');
    await api.get('/administrator');
    await api.get('/coupons/available', { params: { next: '/admin/coupons' } });

    expect(requests.map(credentials)).toEqual([asAdmin, asAdmin, asCustomer, asCustomer]);
  });

  it('keeps customer and admin sessions apart with a relative API base URL', async () => {
    const { adminCouponApi, userApi, requests } = await setupApi(both, '/api');

    await adminCouponApi.getList();
    await userApi.getProfile();

    expect(requests.map(credentials)).toEqual([asAdmin, asCustomer]);
  });

  it('sends selected quantities and an optional coupon ID with customer credentials for an order preview', async () => {
    const { orderApi, requests } = await setupApi(both);

    await orderApi.preview({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 });

    expect(requests[0]).toMatchObject({ url: '/orders/preview', method: 'post' });
    expect(credentials(requests[0])).toEqual(asCustomer);
    expect(JSON.parse(requests[0].data)).toEqual({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 });
  });

  it("checks the invoking customer's session when the request starts, not after another tab changes storage", async () => {
    const { orderApi, requests } = await setupApi({ session: 'customer-A' });

    const request = orderApi.create({ items: [{ product_id: 12, quantity: 3 }], shipping_address_id: 1, checkout_key: '11111111-1111-4111-8111-111111111111' });
    localStorage.setItem('session', 'customer-B');
    await request;

    expect(requests).toHaveLength(1);
    expect(credentials(requests[0])).toEqual(asCustomer);
  });

  it("refuses to send an order with another tab's identity until the store hydrates it", async () => {
    const { orderApi, useAuthStore, requests } = await setupApi({ session: 'customer-A' });
    localStorage.setItem('session', 'customer-B');
    localStorage.setItem('user', '{"user_id":2,"username":"second","email":"second@example.test"}');

    await expect(orderApi.create({ items: [{ product_id: 12, quantity: 3 }], shipping_address_id: 1, checkout_key: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow(/登录状态已变化/);
    expect(requests).toHaveLength(0);

    useAuthStore.getState().hydrate();
    await orderApi.create({ items: [{ product_id: 22, quantity: 1 }], shipping_address_id: 1, checkout_key: '11111111-1111-4111-8111-111111111111' });
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0].data).items).toEqual([{ product_id: 22, quantity: 1 }]);
  });
});

describe('API client sign-out on 401', () => {
  it('clears only the admin identity and opens admin login after an admin 401', async () => {
    const { adminCouponApi, fail } = await setupApi({ session: 'customer-session', user: '{"user_id":1}', admin_session: 'expired-admin-session', admin_user: '{"admin_id":2}' });
    fail(401, 'Unauthorized');

    await expect(adminCouponApi.getList()).rejects.toThrow(/Unauthorized/);

    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(localStorage.getItem('user')).toBe('{"user_id":1}');
    expect(window.location.pathname).toBe('/admin/login');
  });

  it.each([401, 403, 500])('keeps the admin identity after a customer %i, and signs the customer out only on 401', async (status) => {
    const { userApi, fail } = await setupApi({ session: 'customer-session', user: '{"user_id":1}', admin_session: 'admin-session', admin_user: '{"admin_id":2}' });
    fail(status);

    await expect(userApi.getProfile()).rejects.toThrow(/Request failed/);

    expect(localStorage.getItem('admin_session')).toBe('admin-session');
    expect(localStorage.getItem('admin_user')).toBe('{"admin_id":2}');
    expect(localStorage.getItem('session')).toBe(status === 401 ? null : 'customer-session');
    expect(localStorage.getItem('user')).toBe(status === 401 ? null : '{"user_id":1}');
    expect(window.location.pathname).toBe(status === 401 ? '/login' : '/');
  });

  it.each(['https://example.test/api/admin/coupons', '//example.test/api/orders'])('sends no credentials to the foreign URL %s and cannot sign anyone out from it', async (url) => {
    const { api, requests, fail } = await setupApi(both);

    await api.get(url, { headers: { authorization: 'Bearer customer-session' } });
    expect(authorization(requests[0])).toBeUndefined();

    fail(401, 'Unauthorized');
    await expect(api.get(url)).rejects.toThrow(/Unauthorized/);
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(localStorage.getItem('admin_session')).toBe('admin-session');
    expect(window.location.pathname).toBe('/');
  });

  it.each(['customer', 'admin'] as const)('cannot clear a newly signed-in %s with a late 401 from the earlier session', async (identity) => {
    const tokenKey = identity === 'admin' ? 'admin_session' : 'session';
    const userKey = identity === 'admin' ? 'admin_user' : 'user';
    const loaded = await setupApi({ [tokenKey]: 'old-session', [userKey]: '{"id":1}' });
    const started = deferred<() => void>();
    const adapter: AxiosAdapter = config => new Promise((_, reject) => {
      started.resolve(() => reject(Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } })));
    });
    loaded.api.defaults.adapter = adapter;

    const request = identity === 'admin' ? loaded.adminCouponApi.getList() : loaded.userApi.getProfile();
    const failRequest = await started.promise;
    localStorage.setItem(tokenKey, 'new-session');
    localStorage.setItem(userKey, '{"id":2}');
    failRequest();

    await expect(request).rejects.toThrow(/Unauthorized/);
    expect(localStorage.getItem(tokenKey)).toBe('new-session');
    expect(localStorage.getItem(userKey)).toBe('{"id":2}');
    expect(window.location.pathname).toBe('/');
  });
});

describe('API client sign-in routes', () => {
  it.each(['/users/login', '/users/register', '/admin/login'])('sends POST %s without a session and keeps both sessions after a failed attempt', async (path) => {
    const { api, requests, fail } = await setupApi({ ...both, admin_user: '{"username":"Admin"}' });
    const customer = localStorage.getItem('user'), admin = localStorage.getItem('admin_user');
    window.history.replaceState(null, '', '/login?passwordChanged=1');
    fail(401, 'Incorrect credentials');

    await expect(api.post(path, { password: 'test-password' }, { headers: { Authorization: 'Bearer supplied-session' } })).rejects.toThrow(/Incorrect credentials/);

    expect(authorization(requests[0])).toBeUndefined();
    expect(localStorage.getItem('session')).toBe('customer-session');
    expect(localStorage.getItem('user')).toBe(customer);
    expect(localStorage.getItem('admin_session')).toBe('admin-session');
    expect(localStorage.getItem('admin_user')).toBe(admin);
    expect(window.location.pathname + window.location.search).toBe('/login?passwordChanged=1');
  });

  it('keeps only POST sign-in routes anonymous; other methods and similar paths keep their guarded identity', async () => {
    const { api, userApi, requests } = await setupApi({ session: 'customer-a', admin_session: 'admin-a' });

    await api.get('/users/login');
    await api.get('/users/register');
    await api.put('/admin/login', {});
    await api.post('/users/login-extra', {});
    await api.post('/users/register/profile', {});
    await api.post('/admin/login/other', {});
    expect(requests.map(authorization)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);

    localStorage.setItem('session', 'other-tab-customer');
    await userApi.login({ email: 'customer@example.test', password: 'test-password' });
    await userApi.register({ username: 'Customer', email: 'customer@example.test', password: 'test-password' });
    for (const config of requests.slice(-2)) expect(authorization(config)).toBeFalsy();
    await expect(api.get('/users/login')).rejects.toThrow(/登录状态已变化/);
    await expect(api.post('/users/login-extra', {})).rejects.toThrow(/登录状态已变化/);
  });
});

describe('API client cookie session', () => {
  it('can clear a changed cookie without a current stored identity, while guarding other logout paths', async () => {
    const { api, requests } = await setupApi({ session: 'customer-a' });
    localStorage.setItem('session', 'customer-b');
    await api.post('/users/logout');
    expect(requests).toHaveLength(1);
    expect(credentials(requests[0])).toEqual(asCustomer);
    await expect(api.get('/users/logout')).rejects.toThrow(/登录状态已变化/);
    await expect(api.post('/users/logout/other')).rejects.toThrow(/登录状态已变化/);
    expect(requests).toHaveLength(1);
  });
  it('sends anonymous and customer requests with credentials and the CSRF header, and never stores a token', async () => {
    const { productApi, userApi, requests } = await setupApi({});

    await productApi.list({ page: 1 });
    await userApi.login({ email: 'customer@example.test', password: 'test-password' });
    await userApi.logout();

    expect(requests.map(config => [config.method, config.url])).toEqual([['get', '/products'], ['post', '/users/login'], ['post', '/users/logout']]);
    for (const config of requests) expect(credentials(config)).toEqual(asCustomer);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('signs a customer out on a 401 for the session it was sent with', async () => {
    const { userApi, fail } = await setupApi({ session: 'customer-session' });
    fail(401, 'Unauthorized');

    await expect(userApi.getProfile()).rejects.toThrow(/Unauthorized/);
    expect(localStorage.getItem('session')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });
});

describe('API client admin cookie session', () => {
  it('posts the admin logout with credentials and the CSRF header', async () => {
    const { adminApi, requests } = await setupApi({ admin_session: 'admin-session', admin_user: '{"admin_id":2,"username":"admin"}' });

    await adminApi.logout();

    expect(requests.map(config => [config.method, config.url])).toEqual([['post', '/admin/logout']]);
    expect(credentials(requests[0])).toEqual(asAdmin);
  });
});
