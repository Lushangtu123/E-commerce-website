const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadPage, loadApi, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return { promise, resolve, reject }; };
function browser(storage = {}) {
  const result = createBrowser({ token: 'customer-session', user: '{"user_id":1}', 'ecommerce-locale': 'en-US', ...storage });
  const listeners = new Map();
  result.window.addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
  };
  result.window.removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
  result.window.dispatchEvent = event => {
    for (const callback of listeners.get(event.type) || []) callback(event);
    return true;
  };
  result.Event = class { constructor(type) { this.type = type; } };
  result.storageChanged = key => result.window.dispatchEvent({ type: 'storage', key });
  result.listeners = listeners;
  return result;
}
const admin = (username, admin_id = 1) => JSON.stringify({ admin_id, username, real_name: null, role_name: '管理员' });
function layout(context) {
  const redirects = [];
  const router = { push: path => redirects.push(path), replace: path => redirects.push(path) };
  const runtime = loadPage('src/components/AdminLayout.tsx', {
    globals: context,
    props: { children: 'Protected administration' },
    imports: { 'next/navigation': { useRouter: () => router, usePathname: () => '/admin/logs' } },
  });
  return { runtime, redirects };
}

test('invalid administrator JSON and render fields safely redirect without exposing protected content', async () => {
  for (const admin_user of ['{bad', 'null', '[]', '{}', '{"username":{}}', '{"username":""}', '{"username":"valid","real_name":{}}', '{"username":"valid","role_name":4}', '{"username":"valid","admin_id":-1}']) {
    const context = browser({ admin_token: 'admin-session', admin_user });
    const { runtime, redirects } = layout(context);
    let tree;
    await assert.doesNotReject(async () => { tree = await runtime.flush(); });
    assert.ok(redirects.includes('/admin/login'), admin_user);
    assert.ok(!text(tree).includes('Protected administration'));
    assert.equal(context.localStorage.getItem('token'), 'customer-session');
    assert.equal(context.localStorage.getItem('ecommerce-locale'), 'en-US');
  }
});

test('administrator storage denial redirects safely and valid historical username-only sessions still render', async () => {
  const denied = browser();
  denied.localStorage.getItem = () => { throw new Error('Storage denied'); };
  const blocked = layout(denied);
  await assert.doesNotReject(() => blocked.runtime.flush());
  assert.ok(blocked.redirects.includes('/admin/login'));
  const historical = layout(browser({ admin_token: 'admin-session', admin_user: '{"username":"legacy","role_name":"管理员"}' }));
  const tree = await historical.runtime.flush();
  assert.ok(text(tree).includes('legacy')); assert.ok(text(tree).includes('Protected administration'));
  assert.deepEqual(historical.redirects, []);
});

test('administrator layout follows cross-tab changes and ignores listeners after unmount', async () => {
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime, redirects } = layout(context);
  assert.ok(text(await runtime.flush()).includes('first'));
  context.localStorage.setItem('admin_token', 'second-session');
  context.localStorage.setItem('admin_user', admin('second', 2));
  context.storageChanged('admin_user');
  const tree = await runtime.flush();
  assert.ok(text(tree).includes('second')); assert.ok(!text(tree).includes('first'));
  context.localStorage.removeItem('admin_token'); context.storageChanged('admin_token');
  assert.ok(!text(await runtime.flush()).includes('Protected administration'));
  assert.ok(redirects.includes('/admin/login'));
  runtime.unmount();
  const before = redirects.length;
  context.storageChanged(null);
  assert.equal(redirects.length, before);
  assert.equal(context.listeners.get('storage')?.size || 0, 0);
});

test('an old logout handler cannot remove a replacement administrator session', async () => {
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime, redirects } = layout(context);
  const tree = await runtime.flush();
  const logout = findElements(tree, element => element.type === 'button' && text(element).includes('退出登录'))[0];
  context.localStorage.setItem('admin_token', 'second-session');
  context.localStorage.setItem('admin_user', admin('second', 2));
  await logout.props.onClick();
  assert.equal(context.localStorage.getItem('admin_token'), 'second-session');
  assert.deepEqual(redirects, []);
});

test('a saved logout handler cannot clear credentials or navigate after its layout unmounts', async () => {
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime, redirects } = layout(context);
  const tree = await runtime.flush();
  const logout = findElements(tree, element => element.type === 'button' && text(element).includes('退出登录'))[0].props.onClick;
  runtime.unmount();
  await logout();
  assert.equal(context.localStorage.getItem('admin_token'), 'first-session');
  assert.deepEqual(redirects, []);
});

test('an administrator 401 preserves the original rejection when storage becomes inaccessible', async () => {
  const context = loadApi({ admin_token: 'admin-session', admin_user: admin('first') });
  const error = new Error('Unauthorized administrator');
  context.default.defaults.adapter = async config => {
    context.localStorage.getItem = () => { throw new Error('Storage denied'); };
    throw Object.assign(error, { config, response: { status: 401 } });
  };
  await assert.rejects(context.default.get('/admin/logs'), actual => actual === error);
  assert.equal(context.window.location.href, '/current');
});

test('public category reads remain anonymous when customer storage differs from hydrated auth', async () => {
  const context = loadApi({ token: 'customer-A', admin_token: 'admin-session', admin_user: admin('administrator') });
  context.localStorage.setItem('token', 'customer-B');
  for (const url of ['/products/categories', 'products/categories', 'http://localhost:3001/api/products/categories']) {
    await assert.doesNotReject(() => context.default.get(url, { headers: { Authorization: 'Bearer supplied-session' } }));
    assert.equal(context.requests.at(-1).headers.get('Authorization'), undefined);
  }
  assert.equal(context.requests.length, 3);
  await assert.rejects(context.cartApi.list(), /登录状态已变化/);
  await assert.rejects(context.default.post('/products/categories', {}), /登录状态已变化/);
  assert.equal(context.requests.length, 3);
  assert.equal(context.localStorage.getItem('admin_token'), 'admin-session');
});

function logsPage(context, get) {
  const requests = [];
  const runtime = loadPage('src/app/admin/logs/page.tsx', {
    globals: { ...context, fetch: async () => ({ ok: true, json: async () => ({ logs: [], pagination: { total: 0 } }) }) },
    imports: {
      '@/components/AdminLayout': ({ children }) => children,
      '@/lib/api': { __esModule: true, default: { get: (...args) => { requests.push(args); return get(...args); } } },
    },
  });
  return { runtime, requests };
}
const log = description => ({ log_id: 1, username: 'administrator', action: 'LOGIN', description, created_at: '2026-10-04T12:00:00Z' });

test('logs use shared API and show a retryable error rather than a successful empty table', async () => {
  let calls = 0;
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime, requests } = logsPage(context, async () => {
    if (++calls === 1) throw { response: { data: { error: '获取日志失败' } } };
    return { logs: [log('Current logs')], pagination: { total: 1 } };
  });
  let tree = await runtime.flush();
  assert.equal(requests[0]?.[0], '/admin/logs');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0]?.[1]?.params)), { page: 1, limit: 20 });
  assert.ok(findElements(tree, element => element.props.role === 'alert').length);
  const retry = findElements(tree, element => element.type === 'button' && text(element) === '重新加载')[0];
  assert.ok(retry); await retry.props.onClick();
  tree = await runtime.flush(); assert.ok(text(tree).includes('Current logs'));
});

test('logs discard a delayed response from a previous page', async () => {
  const delayed = deferred(); let calls = 0;
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime } = logsPage(context, async (_url, { params }) => {
    if (++calls === 2) return delayed.promise;
    return { logs: [log(`Page ${params.page}`)], pagination: { total: 41 } };
  });
  let tree = await runtime.flush();
  await findElements(tree, element => element.type === 'button' && text(element) === '下一页')[0].props.onClick();
  await runtime.flush();
  // Start a newer query by changing identity while the second page is pending.
  context.localStorage.setItem('admin_token', 'second-session'); context.localStorage.setItem('admin_user', admin('second', 2)); context.storageChanged('admin_user');
  tree = await runtime.flush();
  assert.ok(text(tree).includes('Page 1'));
  delayed.resolve({ logs: [log('Old page')], pagination: { total: 41 } });
  tree = await runtime.flush(); assert.ok(!text(tree).includes('Old page'));
});

test('logs ignore old identity outcomes even before storage event delivery and after unmount', async () => {
  for (const change of ['storage', 'unmount']) for (const fails of [false, true]) {
    const delayed = deferred();
    const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
    const { runtime } = logsPage(context, () => delayed.promise);
    await runtime.flush();
    if (change === 'storage') { context.localStorage.setItem('admin_token', 'second-session'); context.localStorage.setItem('admin_user', admin('second', 2)); }
    else runtime.unmount();
    if (fails) delayed.reject(new Error('Old failure')); else delayed.resolve({ logs: [log('Old logs')], pagination: { total: 1 } });
    await new Promise(setImmediate);
    const tree = await runtime.render();
    assert.ok(!text(tree).includes('Old logs')); assert.ok(!text(tree).includes('Old failure'));
  }
});

test('a saved old pagination handler cannot invalidate the pending current log page', async () => {
  const delayed = deferred();
  const context = browser({ admin_token: 'first-session', admin_user: admin('first') });
  const { runtime, requests } = logsPage(context, async (_url, { params }) => params.page === 2 ? delayed.promise : { logs: [log('First page')], pagination: { total: 41 } });
  const tree = await runtime.flush();
  const next = findElements(tree, element => element.type === 'button' && text(element) === '下一页')[0].props.onClick;
  await next(); await runtime.flush();
  await next();
  delayed.resolve({ logs: [log('Second page')], pagination: { total: 41 } });
  const current = await runtime.flush();
  assert.ok(text(current).includes('Second page'));
  assert.equal(requests.length, 2);
});
