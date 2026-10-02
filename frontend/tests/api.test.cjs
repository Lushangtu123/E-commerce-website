const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./runtime.cjs');

test('cart variant deletion targets its SKU while absent SKU still targets only the base row', async () => {
  const { cartApi, requests } = loadApi({ token: 'customer-session' });
  await cartApi.remove(12, 101);
  await cartApi.remove(12);
  assert.equal(requests[0].params?.sku_id, 101);
  assert.equal(requests[1].params?.sku_id, undefined);
  await cartApi.add({ product_id: 12, quantity: 2, sku_id: 101 });
  await cartApi.updateQuantity({ product_id: 12, quantity: 3, sku_id: 102 });
  assert.deepEqual(JSON.parse(requests[2].data), { product_id: 12, quantity: 2, sku_id: 101 });
  assert.deepEqual(JSON.parse(requests[3].data), { product_id: 12, quantity: 3, sku_id: 102 });
});

test('admin coupon requests use the admin token when both identities are logged in', async () => {
  const { adminCouponApi, requests } = loadApi({ token: 'customer-session', admin_token: 'admin-session' });

  await adminCouponApi.getList(2, 50, 1);

  assert.equal(requests[0].headers.Authorization, 'Bearer admin-session');
  assert.deepEqual(requests[0].params, { page: 2, page_size: 50, status: 1 });
});

test('an admin 401 clears only the admin identity and opens admin login', async () => {
  const browser = loadApi({
    token: 'customer-session', user: '{"user_id":1}',
    admin_token: 'expired-admin-session', admin_user: '{"admin_id":2}',
  });
  browser.default.defaults.adapter = async (config) => {
    throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
  };

  await assert.rejects(browser.adminCouponApi.getList(), /Unauthorized/);

  assert.equal(browser.localStorage.getItem('admin_token'), null);
  assert.equal(browser.localStorage.getItem('admin_user'), null);
  assert.equal(browser.localStorage.getItem('token'), 'customer-session');
  assert.equal(browser.localStorage.getItem('user'), '{"user_id":1}');
  assert.equal(browser.window.location.href, '/admin/login');
});

test('customer requests preserve their token, body, params and response', async () => {
  const { cartApi, couponApi, requests } = loadApi({ token: 'customer-session', admin_token: 'admin-session' });

  await cartApi.add({ product_id: 12, quantity: 3 });
  const result = await couponApi.getMyCoupons(1);

  assert.equal(requests[0].headers.Authorization, 'Bearer customer-session');
  assert.deepEqual(JSON.parse(requests[0].data), { product_id: 12, quantity: 3 });
  assert.equal(requests[1].headers.Authorization, 'Bearer customer-session');
  assert.equal(requests[1].params.status, 1);
  assert.deepEqual(result, { data: [] });
});

test('missing credentials never fall back to the other identity or retain a supplied token', async () => {
  for (const [storage, url] of [
    [{ token: 'customer-session' }, '/admin/coupons'],
    [{ admin_token: 'admin-session' }, '/coupons/my/list'],
  ]) {
    for (const header of ['Authorization', 'authorization']) {
      const { default: api, requests } = loadApi(storage);

      await api.get(url, { headers: { [header]: 'Bearer other-identity' } });

      assert.equal(requests[0].headers.get('Authorization'), undefined);
    }
  }
});

test('absolute and relative admin URLs use admin credentials while lookalike paths use customer credentials', async () => {
  const { default: api, requests } = loadApi({ token: 'customer-session', admin_token: 'admin-session' });

  await api.get('http://localhost:3001/api/admin/coupons');
  await api.get('admin/coupons');
  await api.get('/administrator');
  await api.get('/coupons/available', { params: { next: '/admin/coupons' } });

  assert.deepEqual(requests.map((config) => config.headers.Authorization), [
    'Bearer admin-session', 'Bearer admin-session', 'Bearer customer-session', 'Bearer customer-session',
  ]);
});

test('a customer 401 preserves the admin identity and other HTTP errors preserve both identities', async () => {
  for (const status of [401, 403, 500]) {
    const browser = loadApi({
      token: 'customer-session', user: '{"user_id":1}',
      admin_token: 'admin-session', admin_user: '{"admin_id":2}',
    });
    browser.default.defaults.adapter = async (config) => {
      throw Object.assign(new Error('Request failed'), { config, response: { status } });
    };

    await assert.rejects(browser.userApi.getProfile(), /Request failed/);

    assert.equal(browser.localStorage.getItem('admin_token'), 'admin-session');
    assert.equal(browser.localStorage.getItem('admin_user'), '{"admin_id":2}');
    assert.equal(browser.localStorage.getItem('token'), status === 401 ? null : 'customer-session');
    assert.equal(browser.localStorage.getItem('user'), status === 401 ? null : '{"user_id":1}');
    assert.equal(browser.window.location.href, status === 401 ? '/login' : '/current');
  }
});

test('relative API base URLs preserve separate customer and admin sessions', async () => {
  const { adminCouponApi, userApi, requests } = loadApi({ token: 'customer-session', admin_token: 'admin-session' }, '/api');

  await adminCouponApi.getList();
  await userApi.getProfile();

  assert.deepEqual(requests.map((config) => config.headers.get('Authorization')), ['Bearer admin-session', 'Bearer customer-session']);
});

test('foreign-origin URLs receive no session credentials and cannot log either identity out', async () => {
  for (const url of ['https://example.test/api/admin/coupons', '//example.test/api/orders']) {
    const browser = loadApi({ token: 'customer-session', admin_token: 'admin-session' });

    await browser.default.get(url, { headers: { authorization: 'Bearer customer-session' } });
    assert.equal(browser.requests[0].headers.get('Authorization'), undefined);

    browser.default.defaults.adapter = async (config) => {
      throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
    };
    await assert.rejects(browser.default.get(url), /Unauthorized/);

    assert.equal(browser.localStorage.getItem('token'), 'customer-session');
    assert.equal(browser.localStorage.getItem('admin_token'), 'admin-session');
    assert.equal(browser.window.location.href, '/current');
  }
});

test('a late 401 from an earlier session cannot clear a newly logged in identity', async () => {
  for (const identity of ['customer', 'admin']) {
    const tokenKey = identity === 'admin' ? 'admin_token' : 'token';
    const userKey = identity === 'admin' ? 'admin_user' : 'user';
    const browser = loadApi({ [tokenKey]: 'old-session', [userKey]: '{"id":1}' });
    let failRequest;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    browser.default.defaults.adapter = (config) => new Promise((resolve, reject) => {
      failRequest = () => reject(Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } }));
      markStarted();
    });
    const request = identity === 'admin' ? browser.adminCouponApi.getList() : browser.userApi.getProfile();
    await started;
    browser.localStorage.setItem(tokenKey, 'new-session');
    browser.localStorage.setItem(userKey, '{"id":2}');

    failRequest();
    await assert.rejects(request, /Unauthorized/);

    assert.equal(browser.localStorage.getItem(tokenKey), 'new-session');
    assert.equal(browser.localStorage.getItem(userKey), '{"id":2}');
    assert.equal(browser.window.location.href, '/current');
  }
});

test('order previews send selected product quantities and optional coupon ID with customer credentials', async () => {
  const { orderApi, requests } = loadApi({ token: 'customer-session', admin_token: 'admin-session' });

  await orderApi.preview({ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 });

  assert.equal(requests[0].url, '/orders/preview');
  assert.equal(requests[0].method, 'post');
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer customer-session');
  assert.deepEqual(JSON.parse(requests[0].data), { items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 });
});

test('an order request captures the invoking customer token before a different tab changes storage', async () => {
  const browser = loadApi({ token: 'customer-A' });

  const request = browser.orderApi.create({ items: [{ product_id: 12, quantity: 3 }] });
  browser.localStorage.setItem('token', 'customer-B');
  await request;

  assert.equal(browser.requests[0].headers.get('Authorization'), 'Bearer customer-A');
});

test('a hydrated customer cannot send an order with another tab identity until storage is hydrated', async () => {
  const browser = loadApi({ token: 'customer-A' });
  browser.localStorage.setItem('token', 'customer-B');
  browser.localStorage.setItem('user', '{"user_id":2,"username":"second","email":"second@example.test"}');

  await assert.rejects(browser.orderApi.create({ items: [{ product_id: 12, quantity: 3 }] }), /登录状态已变化/);
  assert.equal(browser.requests.length, 0);

  browser.useAuthStore.getState().hydrate();
  await browser.orderApi.create({ items: [{ product_id: 22, quantity: 1 }] });
  assert.equal(browser.requests[0].headers.get('Authorization'), 'Bearer customer-B');
});
