const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadApi, loadPage, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, node => node.type === 'button' && text(node) === label)[0];
const form = tree => findElements(tree, node => node.type === 'form')[0];
const field = (tree, name) => findElements(tree, node => node.type === 'input' && node.props.name === name)[0];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });
const user = { user_id: 1, username: 'Customer', email: 'customer@test' }, replacement = { user_id: 2, username: 'Replacement', email: 'replacement@test' };
const request = (status = 'requested', reason = 'Damaged item') => ({ request_id: 7, order_id: 1, user_id: 1, order_no: 'ORDER-1', type: 'return', reason, status, review_note: null, created_at: '2026-10-04T00:00:00Z' });

function customerContext({ get = async () => ({ after_sales: null }), create = async () => ({ after_sales: request() }), withdraw = async () => ({ after_sales: request('withdrawn') }) } = {}) {
  const stores = loadStores(); stores.useAuthStore.getState().login(user, 'session-a');
  const reads = [], writes = [];
  const runtime = loadPage('src/components/OrderAfterSales.tsx', { props: { orderId: 1 }, globals: stores, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    '@/lib/api': { afterSalesApi: {
      get: async id => { reads.push({ id, token: stores.useAuthStore.getState().token }); return get(id); },
      create: async (id, data) => { writes.push({ id, data: JSON.parse(JSON.stringify(data)) }); return create(id, data); },
      withdraw: async id => { writes.push({ id, action: 'withdraw' }); return withdraw(id); },
    } },
  } });
  return { ...stores, runtime, reads, writes };
}
async function fillRequest(context, reason = ' Damaged item ') {
  let tree = await context.runtime.flush();
  findElements(tree, node => node.type === 'select')[0].props.onChange({ target: { value: 'return' } }); tree = await context.runtime.flush();
  findElements(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: reason } }); return context.runtime.flush();
}

test('customer after-sales submits a normalized request once, shows canonical status and withdraws without claiming a refund', async () => {
  const context = customerContext(); let tree = await fillRequest(context); await submit(tree); tree = await context.runtime.flush();
  assert.deepEqual(context.writes, [{ id: 1, data: { type: 'return', reason: 'Damaged item' } }]);
  assert.ok(text(tree).includes('待审核')); assert.ok(text(tree).includes('不会自动退款')); assert.equal(form(tree), undefined);
  await button(tree, '撤回申请').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(context.writes.at(-1), { id: 1, action: 'withdraw' }); assert.ok(text(tree).includes('已撤回')); assert.equal(button(tree, '撤回申请'), undefined); assert.equal(form(tree), undefined);
});

test('reviewed after-sales show review_note and no repeated application or withdrawal actions', async () => {
  for (const status of ['approved', 'rejected', 'withdrawn']) {
    const context = customerContext({ get: async () => ({ after_sales: { ...request(status), review_note: 'Please contact support' } }) });
    const tree = await context.runtime.flush(); assert.ok(text(tree).includes('Please contact support')); assert.equal(form(tree), undefined); assert.equal(button(tree, '撤回申请'), undefined);
    if (status === 'approved') assert.ok(text(tree).includes('审核通过'));
  }
});

test('after-sales pending writes block duplicate submission and preserve the request draft on server failure', async () => {
  const pending = deferred(), context = customerContext({ create: () => pending.promise });
  let tree = await fillRequest(context); const first = submit(tree), duplicate = submit(tree); assert.equal(context.writes.length, 1);
  tree = await context.runtime.flush(); assert.equal(findElements(tree, node => node.type === 'textarea')[0].props.disabled, true);
  pending.reject({ response: { data: { error: '提交售后申请失败' } } }); await Promise.all([first, duplicate]); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('提交售后申请失败')); assert.equal(findElements(tree, node => node.type === 'textarea')[0].props.value, ' Damaged item '); assert.equal(button(tree, '提交申请').props.disabled, false);
});

test('invalid after-sales reasons and old account actions cannot submit', async () => {
  for (const reason of ['', ' ', 'x'.repeat(501)]) {
    const context = customerContext(), tree = await fillRequest(context, reason); await submit(tree); assert.deepEqual(context.writes, []);
  }
  for (const change of ['account', 'storage']) {
    const context = customerContext(), tree = await fillRequest(context);
    if (change === 'account') context.useAuthStore.getState().login(replacement, 'session-b');
    else context.localStorage.setItem('token', 'session-b');
    await submit(tree); assert.deepEqual(context.writes, []);
  }
});

test('after-sales reads hide the previous account immediately and ignore its delayed record', async () => {
  const old = deferred(); let context;
  context = customerContext({ get: () => context.useAuthStore.getState().token === 'session-a' ? old.promise : Promise.resolve({ after_sales: request('approved', 'Replacement request') }) });
  await context.runtime.render(); context.useAuthStore.getState().login(replacement, 'session-b');
  let tree = await context.runtime.render(); assert.ok(!text(tree).includes('Damaged item'));
  tree = await context.runtime.flush(); assert.ok(text(tree).includes('Replacement request'));
  old.resolve({ after_sales: request() }); await new Promise(setImmediate); tree = await context.runtime.flush();
  assert.ok(!text(tree).includes('Damaged item')); assert.ok(text(tree).includes('Replacement request'));
});

test('after-sales mutation outcomes cannot replace a new account or publish notices after storage change or unmount', async () => {
  for (const change of ['account', 'storage', 'unmount']) for (const outcome of ['success', 'failure']) {
    const pending = deferred(), context = customerContext({ create: () => pending.promise });
    const tree = await fillRequest(context), work = submit(tree);
    if (change === 'account') { context.useAuthStore.getState().login(replacement, 'session-b'); await context.runtime.flush(); }
    if (change === 'storage') context.localStorage.setItem('token', 'session-b');
    if (change === 'unmount') context.runtime.unmount();
    const reads = context.reads.length;
    if (outcome === 'success') pending.resolve({ after_sales: request() }); else pending.reject({ response: { data: { error: 'Old request failure' } } });
    await work; assert.equal(context.reads.length, reads);
    if (change !== 'unmount') { const current = await context.runtime.flush(); assert.ok(!text(current).includes('Old request failure')); assert.ok(!text(current).includes('售后申请已提交')); }
  }
});

function adminContext(kind, { list, mutate = async () => ({}) } = {}) {
  const browser = loadApi({ admin_token: 'admin-a', admin_user: JSON.stringify({ admin_id: 1, username: 'Admin A' }) });
  const listeners = new Map(), reads = [], writes = [], notices = [];
  const window = { ...browser.window,
    addEventListener(name, listener) { const entries = listeners.get(name) || []; entries.push(listener); listeners.set(name, entries); },
    removeEventListener(name, listener) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== listener)); },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  };
  const defaultResult = kind === 'orders' ? { orders: [{ order_id: 1, order_no: 'ORDER-1', status: 1, total_amount: '10.00', shipping_company: null, tracking_number: null }], pagination: { total: 1 } } : { requests: [request()], pagination: { total: 1 } };
  browser.default.defaults.adapter = async config => {
    const item = { path: config.url, params: config.params, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, authorization: config.headers.get('Authorization') };
    let data;
    if (config.method === 'get') { reads.push(item); data = list ? await list(item) : defaultResult; }
    else { writes.push(item); data = await mutate(item); }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const runtime = loadPage(`src/app/admin/${kind}/page.tsx`, { globals: { ...browser, window, confirm: () => true }, imports: {
    '@/components/AdminLayout': ({ children }) => children,
    '@/lib/api': { ...browser, __esModule: true, default: browser.default },
    'react-hot-toast': { __esModule: true, default: { success: value => notices.push(value), error: value => notices.push(value) } },
  } });
  const changeAdmin = () => { browser.localStorage.setItem('admin_token', 'admin-b'); browser.localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Admin B' })); window.dispatchEvent({ type: 'storage', key: 'admin_token' }); };
  return { ...browser, runtime, window, listeners, reads, writes, notices, changeAdmin };
}
async function fillShipment(context) {
  let tree = await context.runtime.flush(); await button(tree, '发货').props.onClick(); tree = await context.runtime.flush();
  for (const [name, value] of [['shipping_company', ' SF Express '], ['tracking_number', ' SF123456 ']]) { field(tree, name).props.onChange({ target: { value } }); tree = await context.runtime.flush(); }
  return tree;
}

test('shipping requires both fields before the legal transition and deduplicates status updates', async () => {
  const pending = deferred(), context = adminContext('orders', { mutate: () => pending.promise });
  let tree = await context.runtime.flush(); await button(tree, '发货').props.onClick(); tree = await context.runtime.flush();
  await submit(tree); assert.deepEqual(context.writes, []); assert.ok(context.notices.includes('请填写有效的快递公司和运单号'));
  tree = await fillShipment(context); const first = submit(tree), duplicate = submit(tree); assert.equal(context.writes.length, 1);
  assert.deepEqual(context.writes[0].data, { status: 2, shipping_company: 'SF Express', tracking_number: 'SF123456' }); assert.equal(context.writes[0].authorization, 'Bearer admin-a');
  tree = await context.runtime.flush(); assert.equal(button(tree, '确认发货').props.disabled, true);
  pending.resolve({}); await Promise.all([first, duplicate]); await context.runtime.flush(); assert.ok(context.notices.includes('订单状态已更新'));
});

test('shipping drafts and stale shipment handlers cannot cross an administrator replacement', async () => {
  const context = adminContext('orders'), old = await fillShipment(context); context.changeAdmin();
  let tree = await context.runtime.render(); assert.equal(form(tree), undefined); await submit(old); assert.deepEqual(context.writes, []);
  tree = await context.runtime.flush(); await button(tree, '发货').props.onClick(); tree = await context.runtime.flush();
  assert.equal(field(tree, 'shipping_company').props.value, ''); assert.equal(field(tree, 'tracking_number').props.value, '');
});

test('late shipment outcome cannot refresh or notify after raw token change or unmount', async () => {
  for (const change of ['storage', 'unmount']) for (const outcome of ['success', 'failure']) {
    const pending = deferred(), context = adminContext('orders', { mutate: () => pending.promise }), tree = await fillShipment(context), work = submit(tree);
    if (change === 'storage') context.localStorage.setItem('admin_token', 'admin-b'); else context.runtime.unmount();
    const reads = context.reads.length;
    if (outcome === 'success') pending.resolve({}); else pending.reject({ response: { data: { error: 'Old shipping failure' } } });
    await work; assert.equal(context.reads.length, reads); assert.deepEqual(context.notices, []);
  }
});

async function fillReview(context, decision = '通过审核') {
  let tree = await context.runtime.flush(); button(tree, decision).props.onClick(); tree = await context.runtime.flush();
  findElements(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: ' Contact the customer to arrange follow-up ' } }); return context.runtime.flush();
}
test('admin reviews use request_id and require a note; approval clearly does not execute a money refund', async () => {
  const pending = deferred(), context = adminContext('after-sales', { mutate: () => pending.promise });
  let tree = await context.runtime.flush(); assert.ok(text(tree).includes('不会自动退款')); button(tree, '通过审核').props.onClick(); tree = await context.runtime.flush();
  await submit(tree); assert.deepEqual(context.writes, []); assert.ok(context.notices.includes('请填写1至500个字符的审核说明'));
  tree = await fillReview(context); const first = submit(tree), duplicate = submit(tree); assert.equal(context.writes.length, 1);
  assert.equal(context.writes[0].path, '/admin/after-sales/7/review'); assert.deepEqual(context.writes[0].data, { status: 'approved', note: 'Contact the customer to arrange follow-up' }); assert.equal(context.writes[0].authorization, 'Bearer admin-a');
  pending.resolve({}); await Promise.all([first, duplicate]); await context.runtime.flush(); assert.deepEqual(context.notices.at(-1), '售后审核已保存，未执行资金退款');
});

test('changing review filters and administrators clears drafts and immediately invalidates old review handlers', async () => {
  for (const change of ['filter', 'account', 'storage']) {
    const context = adminContext('after-sales'), old = await fillReview(context, '拒绝申请');
    if (change === 'filter') findElements(old, node => node.type === 'select')[0].props.onChange({ target: { value: 'rejected' } });
    if (change === 'account') context.changeAdmin();
    if (change === 'storage') context.localStorage.setItem('admin_token', 'admin-b');
    await submit(old); assert.deepEqual(context.writes, []);
    assert.equal(form(await context.runtime.render()), undefined);
  }
});

test('late review results cannot refresh or notify a replacement admin and reviewed notes use review_note', async () => {
  const pending = deferred(), context = adminContext('after-sales', { mutate: () => pending.promise });
  const tree = await fillReview(context), work = submit(tree); context.changeAdmin(); await context.runtime.flush(); const reads = context.reads.length;
  pending.resolve({}); await work; assert.equal(context.reads.length, reads); assert.deepEqual(context.notices, []);
  const reviewed = adminContext('after-sales', { list: async () => ({ requests: [{ ...request('rejected'), review_note: 'Merchant note' }], pagination: { total: 1 } }) });
  const loaded = await reviewed.runtime.flush(); assert.ok(text(loaded).includes('Merchant note')); assert.equal(button(loaded, '通过审核'), undefined); assert.equal(button(loaded, '拒绝申请'), undefined);
});
