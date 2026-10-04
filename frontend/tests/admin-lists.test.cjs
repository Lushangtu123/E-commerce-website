const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi, loadPage, loadSource, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const input = tree => findElements(tree, element => element.type === 'input' && element.props.type === 'text')[0];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(setImmediate);
const row = (kind, id, title = `Row ${id}`) => kind === 'products' ? { product_id: id, title, price: '10.00', stock: 5, category_id: 1, status: 1 } : { user_id: id, username: title, status: 1, created_at: '2026-10-02' };
const result = (kind, rows, total = rows.length) => ({ [kind]: rows, pagination: { total, totalPages: Math.ceil(total / 20) } });

function setup(kind, { list, mutate = async () => ({}), categories = async () => [] } = {}) {
  const browser = loadApi({ admin_token: 'admin-a', admin_user: JSON.stringify({ admin_id: 1, username: 'Admin A' }) });
  const requests = [], rawRequests = [], mutations = [], notifications = [], listeners = new Map();
  const window = { ...browser.window,
    addEventListener(name, listener) { const values = listeners.get(name) || []; values.push(listener); listeners.set(name, values); },
    removeEventListener(name, listener) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== listener)); },
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  };
  async function request(path, method, params, body, authorization) {
    if (path === '/products/categories') return categories();
    if (method === 'get') {
      requests.push({ path, ...params, authorization });
      if (list) return list(params, authorization);
      const rows = Array.from({ length: 40 }, (_, index) => row(kind, index + 1));
      return result(kind, rows.slice((Number(params.page) - 1) * 20, Number(params.page) * 20), 40);
    }
    mutations.push({ path, method, body, authorization });
    return mutate(path, body, method);
  }
  browser.default.defaults.adapter = async config => ({ status: 200, statusText: 'OK', headers: {}, config,
    data: await request(config.url, config.method, config.params || {}, typeof config.data === 'string' ? JSON.parse(config.data) : config.data, config.headers.get('Authorization')) });
  const fetch = async (url, config = {}) => {
    rawRequests.push(url);
    const path = new URL(url).pathname.replace(/^\/api/, '');
    return { ok: true, json: async () => request(path, (config.method || 'GET').toLowerCase(), Object.fromEntries(new URL(url).searchParams), config.body ? JSON.parse(config.body) : undefined, config.headers?.Authorization) };
  };
  const session = loadSource('src/lib/admin-session.ts', { ...browser, window });
  const toast = { success: message => notifications.push(message), error: message => notifications.push(message) };
  const runtime = loadPage(`src/app/admin/${kind}/page.tsx`, { globals: { ...browser, window, fetch }, imports: {
    '@/lib/api': { __esModule: true, default: browser.default },
    '@/lib/admin-session': session,
    '@/components/AdminLayout': () => null,
    'react-hot-toast': { __esModule: true, default: toast },
  } });
  const changeSession = (token = 'admin-b') => {
    browser.localStorage.setItem('admin_token', token); browser.localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Admin B' }));
    window.dispatchEvent({ type: 'storage', key: 'admin_token', storageArea: browser.localStorage });
  };
  return { ...browser, runtime, requests, rawRequests, mutations, notifications, window, listeners, changeSession };
}

test('the current filter keeps its rows when an older admin list response arrives late', async () => {
  for (const kind of ['products', 'users']) {
    const old = deferred();
    const context = setup(kind, { list: params => params.keyword ? result(kind, [row(kind, 2, 'New filter')]) : old.promise });
    let tree = await context.runtime.render({});
    input(tree).props.onChange({ target: { value: 'new' } });
    tree = await context.runtime.flush(); assert.ok(text(tree).includes('New filter'));
    old.resolve(result(kind, [row(kind, 1, 'Old filter')])); await settle();
    tree = await context.runtime.flush(); assert.ok(text(tree).includes('New filter')); assert.ok(!text(tree).includes('Old filter'));
    assert.equal(context.rawRequests.length, 0); assert.equal(context.requests.at(-1).authorization, 'Bearer admin-a');
  }
});

test('changing filters resets a paginated admin list to its first page', async () => {
  for (const kind of ['products', 'users']) {
    const context = setup(kind);
    let tree = await context.runtime.flush({});
    button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.equal(context.requests.at(-1).page, 2);
    input(tree).props.onChange({ target: { value: 'Row 1' } }); tree = await context.runtime.flush();
    assert.equal(context.requests.at(-1).page, 1); assert.ok(text(tree).includes('第 1 页'));
    findElements(tree, element => element.type === 'select')[0].props.onChange({ target: { value: '0' } });
    await context.runtime.flush(); assert.equal(context.requests.at(-1).page, 1);
  }
});

test('product selection belongs only to the displayed page and filter IDs', async () => {
  const context = setup('products');
  let tree = await context.runtime.flush({});
  let boxes = findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox');
  boxes[0].props.onChange(); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('已选择 20 个商品'));
  const oldRowClick = boxes[1].props.onChange;
  button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
  boxes = findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox');
  assert.equal(boxes[0].props.checked, false); assert.ok(!text(tree).includes('已选择'));
  oldRowClick(); tree = await context.runtime.flush(); assert.ok(!text(tree).includes('已选择'));
  button(tree, '上一页').props.onClick(); tree = await context.runtime.flush();
  assert.ok(!text(tree).includes('已选择'));
  boxes = findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox');
  boxes[1].props.onChange(); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('已选择 1 个商品'));
  input(tree).props.onChange({ target: { value: 'changed' } }); tree = await context.runtime.flush();
  assert.ok(!text(tree).includes('已选择'));
});

test('admin list failures show retry and never display failed refreshes as old or empty results', async () => {
  for (const kind of ['products', 'users']) {
    let calls = 0;
    const context = setup(kind, { list: async () => {
      if (++calls !== 2) throw { response: { data: { error: '获取用户列表失败' } } };
      return result(kind, [row(kind, 1, 'Loaded row')]);
    } });
    let tree = await context.runtime.flush({});
    assert.equal(findElements(tree, element => element.props.role === 'alert').length, 1);
    await button(tree, '重新加载').props.onClick(); tree = await context.runtime.flush(); assert.ok(text(tree).includes('Loaded row'));
    await button(tree, '搜索').props.onClick(); tree = await context.runtime.flush();
    assert.ok(!text(tree).includes('Loaded row')); assert.equal(findElements(tree, element => element.props.role === 'alert').length, 1);
    assert.equal(findElements(tree, element => element.type === 'table').length, 0);
  }
});

test('administrator replacement immediately hides rows and resets page and filters through storage events', async () => {
  for (const kind of ['products', 'users']) {
    const replacement = deferred();
    const context = setup(kind, { list: (params, auth) => auth === 'Bearer admin-b' ? replacement.promise : result(kind, [row(kind, 1, 'Admin A data')], 40) });
    let tree = await context.runtime.flush({});
    input(tree).props.onChange({ target: { value: 'Admin A' } }); tree = await context.runtime.flush();
    button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    context.changeSession(); tree = await context.runtime.render();
    assert.ok(!text(tree).includes('Admin A data')); assert.equal(input(tree).props.value, '');
    await context.runtime.flush(); assert.equal(context.requests.at(-1).page, 1); assert.equal(context.requests.at(-1).keyword, undefined);
    replacement.resolve(result(kind, [row(kind, 2, 'Admin B data')])); await settle(); tree = await context.runtime.flush();
    assert.ok(text(tree).includes('Admin B data')); assert.ok(!text(tree).includes('Admin A data'));
    context.runtime.unmount(); assert.equal(context.listeners.get('storage').length, 0);
  }
});

test('admin status submissions are deduplicated and disable competing mutations until refresh finishes', async () => {
  for (const kind of ['products', 'users']) {
    const write = deferred();
    const context = setup(kind, { mutate: () => write.promise });
    let tree = await context.runtime.flush({});
    const action = button(tree, kind === 'products' ? '下架' : '禁用');
    const first = action.props.onClick(), duplicate = action.props.onClick();
    await settle(); assert.equal(context.mutations.length, 1);
    tree = await context.runtime.flush(); assert.equal(button(tree, kind === 'products' ? '下架' : '禁用').props.disabled, true);
    if (kind === 'products') assert.equal(button(tree, '添加商品').props.disabled, true);
    write.resolve({}); await Promise.all([first, duplicate]); tree = await context.runtime.flush();
    assert.equal(context.requests.length, 2); assert.equal(context.notifications.length, 1); assert.equal(context.rawRequests.length, 0);
    assert.equal(button(tree, kind === 'products' ? '下架' : '禁用').props.disabled, false);
  }
});

async function fillAddForm(context) {
  let tree = await context.runtime.flush();
  button(tree, '添加商品').props.onClick(); tree = await context.runtime.flush();
  findElements(tree, element => element.props.placeholder === '请输入商品标题')[0].props.onChange({ target: { value: 'New product' } });
  tree = await context.runtime.flush();
  findElements(tree, element => element.type === 'input' && element.props.type === 'number')[0].props.onChange({ target: { value: '12.5' } });
  tree = await context.runtime.flush();
  findElements(tree, element => element.type === 'select' && text(element).includes('请选择分类'))[0].props.onChange({ target: { value: '1' } });
  return context.runtime.flush();
}

test('product creation is mutually exclusive with duplicate create, row status and batch submissions', async () => {
  const write = deferred();
  const context = setup('products', { mutate: () => write.promise, categories: async () => [{ category_id: 1, name: 'Category' }] });
  let tree = await context.runtime.flush({});
  findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox')[1].props.onChange();
  tree = await fillAddForm(context);
  const create = findElements(tree, element => element.type === 'button' && text(element) === '添加商品').at(-1);
  const first = create.props.onClick(), duplicate = create.props.onClick();
  const status = button(tree, '下架').props.onClick(), batch = button(tree, '批量下架').props.onClick();
  await settle(); assert.equal(context.mutations.length, 1); assert.equal(context.mutations[0].method, 'post');
  assert.equal(context.mutations[0].body.title, 'New product'); assert.equal(context.mutations[0].body.price, 12.5);
  write.resolve({ product_id: 41 }); await Promise.all([first, duplicate, status, batch]);
  tree = await context.runtime.flush(); assert.equal(context.notifications.length, 1); assert.equal(context.rawRequests.length, 0);
  assert.equal(findElements(tree, element => element.type === 'h2' && text(element) === '添加商品').length, 0);
});

test('disabling the last active item on the final page clamps pagination and reloads remaining items', async () => {
  for (const kind of ['products', 'users']) {
    let total = 21;
    const context = setup(kind, { list: params => {
      const rows = Array.from({ length: total }, (_, index) => row(kind, index + 1));
      return result(kind, rows.slice((params.page - 1) * 20, params.page * 20), total);
    }, mutate: async () => { total = 20; } });
    let tree = await context.runtime.flush({});
    findElements(tree, element => element.type === 'select')[0].props.onChange({ target: { value: '1' } }); tree = await context.runtime.flush();
    button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.ok(text(tree).includes('Row 21'));
    await button(tree, kind === 'products' ? '下架' : '禁用').props.onClick(); tree = await context.runtime.flush();
    assert.ok(text(tree).includes('第 1 页')); assert.ok(text(tree).includes('Row 20')); assert.ok(!text(tree).includes('Row 21'));
    assert.equal(context.requests.at(-1).page, 1); assert.equal(context.requests.at(-1).status, '1');
  }
});

test('a replacement administrator cannot see the previous create draft or use its old form handlers', async () => {
  const context = setup('products', { categories: async () => [{ category_id: 1, name: 'Category' }] });
  await context.runtime.flush({});
  let tree = await fillAddForm(context);
  const oldTitle = findElements(tree, element => element.props.placeholder === '请输入商品标题')[0];
  const oldCreate = findElements(tree, element => element.type === 'button' && text(element) === '添加商品').at(-1);
  context.changeSession(); tree = await context.runtime.render();
  assert.equal(findElements(tree, element => element.props.placeholder === '请输入商品标题').length, 0);
  tree = await context.runtime.flush(); button(tree, '添加商品').props.onClick(); tree = await context.runtime.flush();
  assert.equal(findElements(tree, element => element.props.placeholder === '请输入商品标题')[0].props.value, '');
  oldTitle.props.onChange({ target: { value: 'Old handler edit' } }); await oldCreate.props.onClick(); tree = await context.runtime.flush();
  assert.equal(findElements(tree, element => element.props.placeholder === '请输入商品标题')[0].props.value, '');
  assert.equal(context.mutations.length, 0);
});

test('late list success and failure cannot replace a new administrator or its error state', async () => {
  for (const kind of ['products', 'users']) for (const outcome of ['success', 'failure']) {
    const old = deferred();
    const context = setup(kind, { list: (params, auth) => auth === 'Bearer admin-a' ? old.promise : result(kind, [row(kind, 2, 'Replacement rows')]) });
    await context.runtime.render({}); context.changeSession();
    let tree = await context.runtime.flush(); assert.ok(text(tree).includes('Replacement rows'));
    if (outcome === 'success') old.resolve(result(kind, [row(kind, 1, 'Stale rows')]));
    else old.reject({ response: { data: { error: '旧身份错误' } } });
    await settle(); tree = await context.runtime.flush();
    assert.ok(text(tree).includes('Replacement rows')); assert.ok(!text(tree).includes('Stale rows')); assert.equal(context.notifications.length, 0);
    assert.equal(findElements(tree, element => element.props.role === 'alert').length, 0);
  }
});

test('old row mutation handlers reject a replacement storage token before the next render', async () => {
  for (const kind of ['products', 'users']) {
    const context = setup(kind); const tree = await context.runtime.flush({});
    const old = button(tree, kind === 'products' ? '下架' : '禁用').props.onClick;
    context.localStorage.setItem('admin_token', 'admin-b');
    await old(); assert.equal(context.mutations.length, 0);
    await context.runtime.flush(); await old(); assert.equal(context.mutations.length, 0); assert.equal(context.notifications.length, 0);
  }
});

test('late mutations from another administrator or unmounted page cannot notify or refresh', async () => {
  for (const kind of ['products', 'users']) for (const replacement of ['account', 'unmount']) for (const outcome of ['success', 'failure']) {
    const write = deferred(); const context = setup(kind, { mutate: () => write.promise });
    let tree = await context.runtime.flush({});
    const operation = button(tree, kind === 'products' ? '下架' : '禁用').props.onClick();
    await settle();
    if (replacement === 'account') { context.changeSession(); tree = await context.runtime.flush(); }
    else context.runtime.unmount();
    const requestCount = context.requests.length;
    if (outcome === 'success') write.resolve({}); else write.reject({ response: { data: { error: '旧操作失败' } } });
    await operation; await settle();
    assert.equal(context.requests.length, requestCount); assert.equal(context.notifications.length, 0);
  }
});

test('a mutation completed after pagination changes refreshes the current page and keeps old row handlers inactive', async () => {
  for (const kind of ['products', 'users']) {
    const write = deferred(); const context = setup(kind, { mutate: () => write.promise });
    let tree = await context.runtime.flush({}); const old = button(tree, kind === 'products' ? '下架' : '禁用').props.onClick;
    const operation = old(); await settle(); button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.ok(text(tree).includes('Row 21')); await old(); assert.equal(context.mutations.length, 1);
    write.resolve({}); await operation; tree = await context.runtime.flush();
    assert.ok(text(tree).includes('Row 21')); assert.equal(context.requests.at(-1).page, 2); assert.equal(context.notifications.length, 0);
  }
});

test('changing a list scope invalidates row actions immediately before React commits the new query', async () => {
  for (const kind of ['products', 'users']) {
    const context = setup(kind); let tree = await context.runtime.flush({});
    const old = button(tree, kind === 'products' ? '下架' : '禁用').props.onClick;
    input(tree).props.onChange({ target: { value: 'new query' } });
    await old(); assert.equal(context.mutations.length, 0);
    tree = await context.runtime.flush(); assert.equal(context.requests.at(-1).keyword, 'new query');
  }
});
