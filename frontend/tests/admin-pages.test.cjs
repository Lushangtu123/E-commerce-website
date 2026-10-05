const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadPage, loadApi, findElements } = require('./runtime.cjs');

const orders = Array.from({ length: 5 }, (_, status) => ({
  order_id: status + 1, order_no: `ORDER-${status}`, status,
  total_amount: '10.00', created_at: '2026-10-02T00:00:00.000Z',
}));
const statusLabels = ['待支付', '已支付', '已发货', '已完成', '已取消'];
const AdminLayout = ({ children }) => children;
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, node => node.type === 'button' && text(node) === label)[0];
function orderPage(rows = orders) {
  const browser = loadApi({ token: 'customer-session', admin_token: 'admin-session', admin_user: JSON.stringify({ admin_id: 1, username: 'Admin' }) });
  browser.default.defaults.adapter = async config => {
    browser.requests.push(config);
    return { data: { orders: rows, pagination: { total: rows.length } }, status: 200, statusText: 'OK', headers: {}, config };
  };
  const runtime = loadPage('src/app/admin/orders/page.tsx', { globals: { ...browser, confirm: () => true }, imports: { '@/components/AdminLayout': AdminLayout, '@/lib/api': { __esModule: true, default: browser.default } } });
  return { ...browser, runtime };
}

test('admin orders show the saved shipping snapshot instead of current address aliases and identify legacy orders', async () => {
  const snapshot = { receiver_name: 'Original Receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '旧地址 1 号' };
  const { runtime } = orderPage([
    { ...orders[0], shipping_address_snapshot: snapshot, receiver_name: 'Current Receiver', detail_address: '新地址' },
    { ...orders[1], shipping_address_snapshot: null },
  ]);
  const tree = await runtime.flush({});
  assert.ok(text(tree).includes('Original Receiver')); assert.ok(text(tree).includes('浙江省杭州市西湖区旧地址 1 号'));
  assert.ok(!text(tree).includes('Current Receiver')); assert.ok(text(tree).includes('历史订单未记录收货信息'));
});

test('admin orders display and filter the same five statuses as customer orders', async () => {
  const { runtime } = orderPage();

  const tree = await runtime.flush({});
  const options = findElements(tree, (element) => element.type === 'option');
  const badges = findElements(tree, (element) => element.type === 'span' && element.props.className?.includes('rounded-full'));

  assert.deepEqual(options.map((element) => element.props.value), ['', '0', '1', '2', '3', '4']);
  assert.deepEqual(options.slice(1).map((element) => element.props.children), statusLabels);
  assert.deepEqual(badges.map((element) => element.props.children), statusLabels);
});

test('admin dashboard recent orders use the customer order status contract', async () => {
  const runtime = loadPage('src/app/admin/dashboard/page.tsx', {
    initialState: { 1: orders, 4: false, 5: true },
    imports: { '@/components/AdminLayout': AdminLayout, recharts: {} },
  });

  const tree = await runtime.render({});
  const badges = findElements(tree, (element) => element.type === 'span' && element.props.className?.includes('rounded-full'));

  assert.deepEqual(badges.map((element) => element.props.children), statusLabels);
});

test('admin orders offer only legal next states and send them with admin credentials before refreshing', async () => {
  const browser = orderPage(), { runtime } = browser;

  let tree = await runtime.flush({});
  const actions = findElements(tree, (element) => element.type === 'button' && ['取消订单', '发货', '完成订单'].includes(element.props.children));

  assert.deepEqual(actions.map((element) => element.props.children), ['取消订单', '发货', '完成订单']);
  await button(tree, '取消订单').props.onClick(); tree = await runtime.flush();
  await button(tree, '发货').props.onClick(); tree = await runtime.flush();
  assert.equal(browser.requests.filter(config => config.method === 'put').length, 1, 'Opening the shipment form must not mark the order shipped');
  for (const [name, value] of [['shipping_company', 'SF Express'], ['tracking_number', 'SF123456']]) {
    findElements(tree, node => node.type === 'input' && node.props.name === name)[0].props.onChange({ target: { value } }); tree = await runtime.flush();
  }
  await findElements(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await runtime.flush();
  await button(tree, '完成订单').props.onClick(); await runtime.flush();

  const updates = browser.requests.filter((config) => config.method === 'put');
  assert.deepEqual(updates.map((config) => [config.url, JSON.parse(config.data).status]), [
    ['/admin/orders/1/status', 4], ['/admin/orders/2/status', 2], ['/admin/orders/3/status', 3],
  ]);
  assert.ok(browser.requests.every((config) => config.headers.get('Authorization') === 'Bearer admin-session'));
  assert.deepEqual(JSON.parse(updates[1].data), { status: 2, shipping_company: 'SF Express', tracking_number: 'SF123456' });
  assert.ok(browser.requests.filter((config) => config.method === 'get').length >= 4);
});

test('an expired dashboard admin session returns to admin login and preserves customer login', async () => {
  const browser = loadApi({ token: 'customer-session', admin_token: 'expired-admin-session', admin_user: '{"admin_id":2}' });
  browser.default.defaults.adapter = async (config) => {
    throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
  };
  const runtime = loadPage('src/app/admin/dashboard/page.tsx', {
    globals: {
      ...browser,
      fetch: async () => ({ status: 401, ok: false, json: async () => ({ error: 'Unauthorized' }) }),
    },
    imports: {
      '@/components/AdminLayout': AdminLayout, recharts: {},
      '@/lib/api': { __esModule: true, default: browser.default },
    },
  });

  await runtime.render({});

  assert.equal(browser.localStorage.getItem('admin_token'), null);
  assert.equal(browser.localStorage.getItem('admin_user'), null);
  assert.equal(browser.localStorage.getItem('token'), 'customer-session');
  assert.equal(browser.window.location.href, '/admin/login');
});

test('admin coupon management keeps the admin login and navigation frame while loading and after loading', async () => {
  for (const loading of [true, false]) {
    const runtime = loadPage('src/app/admin/coupons/page.tsx', {
      initialState: { 1: loading },
      imports: { '@/components/AdminLayout': AdminLayout },
    });

    const tree = await runtime.render({});

    assert.equal(tree.type, AdminLayout);
  }
});

test('authenticated admins can navigate to coupon management from the sidebar', async () => {
  const admin = { username: 'admin', role_name: '管理员' };
  const runtime = loadPage('src/components/AdminLayout.tsx', {
    initialState: { 0: admin },
    globals: createBrowser({ admin_token: 'admin-session', admin_user: JSON.stringify(admin) }),
    imports: { 'next/navigation': { useRouter: () => ({ push() {} }), usePathname: () => '/admin/coupons' } },
  });

  const tree = await runtime.render({});
  const links = findElements(tree, (element) => element.props.href === '/admin/coupons');

  assert.equal(links.length, 1);
  assert.ok(links[0].props.className.includes('bg-blue-600'));
  assert.ok(findElements(links[0], (element) => element.props.children === '优惠券管理').length > 0);
});
