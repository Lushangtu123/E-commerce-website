const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource, loadStores, loadPage, findElements } = require('./runtime.cjs');

const firstUser = { user_id: 1, username: 'first', email: 'first@test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@test' };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const removeButton = (tree, kind) => findElements(tree, element => element.type === 'button' && element.props.title === (kind === 'favorites' ? '取消收藏' : '删除记录'))[0];
const titles = tree => findElements(tree, element => element.type === 'h2').map(text);
const product = (id, title = `Product ${id}`) => ({ favorite_id: id, id, product_id: id, title, price: '10.00', stock: 3, status: 1, has_sku: false, browsed_at: '2026-10-02T00:00:00Z' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(kind, { list, remove = async () => ({}), clear = async () => ({}), detail = async id => ({ product: product(id) }), add = async () => ({}), confirm = () => true, rows = Array.from({ length: 21 }, (_, index) => product(index + 1)) } = {}) {
  const stores = loadStores(); stores.useAuthStore.getState().login(firstUser, 'first-session');
  const requests = [], mutations = [], notifications = [], productRequests = [], cartRequests = [];
  const toast = { error: message => notifications.push(message), success: message => notifications.push(message) };
  const listing = async params => {
    requests.push({ ...params, token: stores.useAuthStore.getState().token });
    if (list) return list(params);
    return { [kind]: rows.slice((params.page - 1) * params.limit, params.page * params.limit), pagination: { total: rows.length, total_pages: Math.ceil(rows.length / params.limit) } };
  };
  const deleting = async id => { mutations.push(['remove', id]); return remove(id); };
  const clearing = async () => { mutations.push(['clear']); return clear(); };
  const api = {
    favoriteApi: { list: listing, remove: deleting }, browseApi: { getHistory: listing, deleteRecord: deleting, clearHistory: clearing },
    productApi: { getDetail: async id => { productRequests.push(id); return detail(id); } },
    cartApi: { add: async body => { cartRequests.push(JSON.parse(JSON.stringify(body))); return add(body); } },
  };
  const quickCart = loadSource('src/lib/quick-cart.ts', stores, { '@/lib/api': api, '@/store/useAuthStore': stores, '@/store/useCartStore': stores });
  const runtime = loadPage(`src/app/${kind}/page.tsx`, { globals: { ...stores, confirm }, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    '@/lib/api': api, '@/lib/quick-cart': quickCart, 'react-hot-toast': { __esModule: true, default: toast, toast },
  } });
  return { ...stores, runtime, requests, mutations, notifications, productRequests, cartRequests };
}

test('favorites and history failures show an alert with retry rather than an empty list', async () => {
  for (const kind of ['favorites', 'history']) {
    let calls = 0;
    const context = setup(kind, { list: async () => { if (++calls === 1) throw { response: { data: { message: '列表暂时不可用' } } }; return { [kind]: [product(1)], pagination: { total: 1, total_pages: 1 } }; } });
    let tree = await context.runtime.flush({});
    assert.ok(findElements(tree, element => element.props.role === 'alert').length > 0);
    assert.ok(text(tree).includes('列表暂时不可用')); assert.ok(!text(tree).includes(kind === 'favorites' ? '暂无收藏商品' : '暂无浏览记录'));
    assert.ok(text(tree).includes('— 个商品'), 'a failed count is unknown, not zero');
    await button(tree, '重新加载').props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(titles(tree), ['Product 1']); assert.equal(context.requests.length, 2);
  }
});

test('switching account immediately hides loaded rows and counts and starts its first page', async () => {
  for (const kind of ['favorites', 'history']) {
    const nextAccount = deferred();
    const context = setup(kind, { list: async params => context.useAuthStore.getState().token === 'second-session' ? nextAccount.promise : { [kind]: [product(params.page === 1 ? 1 : 21)], pagination: { total: 21, total_pages: 2 } } });
    let tree = await context.runtime.flush({});
    await button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(titles(tree), ['Product 21']);
    context.useAuthStore.getState().login(secondUser, 'second-session');
    tree = await context.runtime.render();
    assert.deepEqual(titles(tree), []); assert.ok(!text(tree).includes('21 个商品'));
    await context.runtime.flush();
    assert.equal(context.requests.at(-1).page, 1); assert.equal(context.requests.at(-1).limit, 20);
    nextAccount.resolve({ [kind]: [product(100, 'Second account')], pagination: { total: 1, total_pages: 1 } });
    tree = await context.runtime.flush(); assert.deepEqual(titles(tree), ['Second account']);
  }
});

test('remove is deduplicated and excludes quick cart and history clear while pending', async () => {
  for (const kind of ['favorites', 'history']) {
    const removal = deferred();
    const context = setup(kind, { rows: [product(1)], remove: () => removal.promise });
    const tree = await context.runtime.flush({});
    const first = removeButton(tree, kind).props.onClick();
    const duplicate = removeButton(tree, kind).props.onClick();
    const cart = button(tree, '加入购物车').props.onClick();
    const clear = kind === 'history' ? button(tree, '清空历史').props.onClick() : Promise.resolve();
    assert.deepEqual(context.mutations, [['remove', 1]]); assert.deepEqual(context.productRequests, []);
    assert.equal(removeButton(await context.runtime.flush(), kind).props.disabled, true);
    removal.resolve({}); await Promise.all([first, duplicate, cart, clear]);
    assert.equal(context.requests.length, 2); assert.equal(context.notifications.length, 1);
  }
});

test('missing and null products stay removable but cannot enter quick cart; string zero stock is sold out', async () => {
  for (const kind of ['favorites', 'history']) {
    const rows = [
      { ...product(1), title: null, price: null, stock: null, status: null },
      { ...product(2), title: '商品已不存在', stock: 0, status: -1 },
      { ...product(3), stock: '0' },
    ];
    const context = setup(kind, { rows });
    const tree = await context.runtime.flush({});
    assert.deepEqual(titles(tree), ['商品已不存在', '商品已不存在', 'Product 3']);
    assert.ok(text(tree).includes('已售罄'));
    const buttons = findElements(tree, element => element.type === 'button' && text(element) === '加入购物车');
    assert.ok(buttons.every(element => element.props.disabled));
    for (const element of buttons) await element.props.onClick();
    assert.deepEqual(context.productRequests, []); assert.deepEqual(context.cartRequests, []);
    await removeButton(tree, kind).props.onClick(); assert.deepEqual(context.mutations, [['remove', 1]]);
  }
});

test('deleting the only row on the final page reloads the remaining valid page', async () => {
  for (const kind of ['favorites', 'history']) {
    const rows = Array.from({ length: 21 }, (_, index) => product(index + 1));
    const context = setup(kind, { rows, remove: async id => { rows.splice(rows.findIndex(row => row.product_id === id), 1); } });
    let tree = await context.runtime.flush({});
    await button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(titles(tree), ['Product 21']);
    await removeButton(tree, kind).props.onClick(); tree = await context.runtime.flush();
    assert.equal(context.requests.at(-1).page, 1);
    assert.equal(titles(tree).length, 20); assert.ok(text(tree).includes('20 个商品'));
    assert.ok(!text(tree).includes(kind === 'favorites' ? '暂无收藏商品' : '暂无浏览记录'));
  }
});

test('late list success or failure cannot restore another account or an unmounted page', async () => {
  for (const kind of ['favorites', 'history']) for (const change of ['account', 'storage', 'unmount']) for (const fail of [false, true]) {
    const pending = deferred(); let calls = 0;
    const context = setup(kind, { list: () => ++calls === 1 ? pending.promise : Promise.resolve({ [kind]: [product(99, 'New account')], pagination: { total: 1, total_pages: 1 } }) });
    await context.runtime.flush({});
    if (change === 'account') { context.useAuthStore.getState().login(secondUser, 'second-session'); await context.runtime.flush(); }
    if (change === 'storage') context.localStorage.setItem('token', 'second-session');
    if (change === 'unmount') context.runtime.unmount();
    if (fail) pending.reject(new Error('Old failure'));
    else pending.resolve({ [kind]: [product(1, 'Old account')], pagination: { total: 1, total_pages: 1 } });
    await new Promise(setImmediate);
    if (change !== 'unmount') {
      const tree = await context.runtime.flush();
      assert.deepEqual(titles(tree), change === 'account' ? ['New account'] : []);
      assert.ok(!text(tree).includes('Old failure'));
    }
    assert.deepEqual(context.notifications, []);
  }
});

test('pending page responses cannot replace the new account and stale loaded row handlers cannot delete', async () => {
  for (const kind of ['favorites', 'history']) for (const fail of [false, true]) {
    const pending = deferred(); let calls = 0;
    const context = setup(kind, { list: params => {
      calls++;
      if (params.page === 2) return pending.promise;
      return Promise.resolve({ [kind]: [product(calls === 1 ? 1 : 2)], pagination: { total: 21, total_pages: 2 } });
    } });
    let tree = await context.runtime.flush({});
    const next = button(tree, '下一页').props.onClick;
    const staleRemove = removeButton(tree, kind).props.onClick;
    await next(); tree = await context.runtime.render();
    assert.deepEqual(titles(tree), []);
    await staleRemove(); assert.deepEqual(context.mutations, []);
    // Changing account is the available navigation while the next page is loading.
    context.useAuthStore.getState().login(secondUser, 'second-session'); tree = await context.runtime.flush();
    if (fail) pending.reject(new Error('Old page failure'));
    else pending.resolve({ [kind]: [product(21)], pagination: { total: 21, total_pages: 2 } });
    tree = await context.runtime.flush(); assert.deepEqual(titles(tree), ['Product 2']);
    assert.deepEqual(context.notifications, []);
  }
});

test('old rendered remove, quick cart and clear handlers cannot act for new browser credentials', async () => {
  for (const kind of ['favorites', 'history']) for (const change of ['account', 'storage', 'unmount']) {
    const context = setup(kind, { rows: [product(1)] });
    const tree = await context.runtime.flush({});
    if (change === 'account') context.useAuthStore.getState().login(secondUser, 'second-session');
    if (change === 'storage') context.localStorage.setItem('token', 'second-session');
    if (change === 'unmount') context.runtime.unmount();
    await removeButton(tree, kind).props.onClick(); await button(tree, '加入购物车').props.onClick();
    if (kind === 'history') await button(tree, '清空历史').props.onClick();
    assert.deepEqual(context.mutations, []); assert.deepEqual(context.productRequests, []);
    assert.deepEqual(context.cartRequests, []); assert.deepEqual(context.notifications, []);
  }
});

test('late deletion or clear outcomes cannot refresh or notify a replacement session', async () => {
  for (const kind of ['favorites', 'history']) for (const action of kind === 'history' ? ['remove', 'clear'] : ['remove']) {
    for (const change of ['account', 'storage', 'unmount']) for (const fail of [false, true]) {
      const pending = deferred();
      const context = setup(kind, { rows: [product(1)], remove: () => pending.promise, clear: () => pending.promise });
      const tree = await context.runtime.flush({});
      const work = (action === 'clear' ? button(tree, '清空历史') : removeButton(tree, kind)).props.onClick();
      if (change === 'account') { context.useAuthStore.getState().login(secondUser, 'second-session'); await context.runtime.flush(); }
      if (change === 'storage') context.localStorage.setItem('token', 'second-session');
      if (change === 'unmount') context.runtime.unmount();
      const before = context.requests.length;
      if (fail) pending.reject(new Error('Old mutation failed')); else pending.resolve({});
      await work; assert.equal(context.requests.length, before); assert.deepEqual(context.notifications, []);
      assert.deepEqual(context.runtime.redirects, []); assert.equal(context.useCartStore.getState().items.length, 0);
    }
  }
});

test('deletion finishing after a page change refreshes the currently displayed page', async () => {
  for (const kind of ['favorites', 'history']) {
    const pending = deferred(); const context = setup(kind, { remove: () => pending.promise });
    let tree = await context.runtime.flush({}); const work = removeButton(tree, kind).props.onClick();
    await button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(titles(tree), ['Product 21']);
    pending.resolve({}); await work; tree = await context.runtime.flush();
    assert.equal(context.requests.at(-1).page, 2); assert.deepEqual(titles(tree), ['Product 21']);
    assert.deepEqual(context.notifications, []);
  }
});

test('history clear validates identity both before and after confirmation and releases canceled actions', async () => {
  for (const change of ['cancel', 'account', 'storage']) {
    let context;
    context = setup('history', { rows: [product(1)], confirm: () => {
      if (change === 'account') context.useAuthStore.getState().login(secondUser, 'second-session');
      if (change === 'storage') context.localStorage.setItem('token', 'second-session');
      return change !== 'cancel';
    } });
    const tree = await context.runtime.flush({}); await button(tree, '清空历史').props.onClick();
    assert.deepEqual(context.mutations, []);
    if (change === 'cancel') {
      const current = await context.runtime.flush(); await removeButton(current, 'history').props.onClick();
      assert.deepEqual(context.mutations, [['remove', 1]]);
    }
  }
});

test('quick cart remains scoped across detail and add delays and retains valid SKU selection', async () => {
  for (const kind of ['favorites', 'history']) for (const phase of ['detail', 'add']) for (const change of ['account', 'storage', 'unmount', 'page']) {
    const pending = deferred();
    const context = setup(kind, { detail: phase === 'detail' ? () => pending.promise : async () => ({ product: product(1) }), add: phase === 'add' ? () => pending.promise : undefined });
    const tree = await context.runtime.flush({}); const work = button(tree, '加入购物车').props.onClick();
    await new Promise(setImmediate);
    if (change === 'account') { context.useAuthStore.getState().login(secondUser, 'second-session'); await context.runtime.flush(); }
    if (change === 'storage') context.localStorage.setItem('token', 'second-session');
    if (change === 'unmount') context.runtime.unmount();
    if (change === 'page') { await button(tree, '下一页').props.onClick(); await context.runtime.flush(); }
    pending.resolve(phase === 'detail' ? { product: product(1) } : {}); await work;
    assert.deepEqual(context.notifications, []); assert.deepEqual(context.runtime.redirects, []);
    assert.equal(context.useCartStore.getState().items.length, 0);
    assert.equal(context.cartRequests.length, phase === 'detail' ? 0 : 1);
  }
  for (const kind of ['favorites', 'history']) {
    const context = setup(kind, { rows: [{ ...product(1), has_sku: true }], detail: async () => ({ product: { ...product(1), has_sku: true } }) });
    await button(await context.runtime.flush({}), '选择规格').props.onClick();
    assert.deepEqual(context.runtime.redirects, ['/products/1']); assert.deepEqual(context.cartRequests, []);
  }
});

test('failed deletion keeps the rows and releases the pending action for retry', async () => {
  for (const kind of ['favorites', 'history']) {
    let calls = 0; const context = setup(kind, { rows: [product(1)], remove: async () => { if (++calls === 1) throw { response: { data: { message: '删除失败测试' } } }; } });
    let tree = await context.runtime.flush({}); await removeButton(tree, kind).props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(titles(tree), ['Product 1']); assert.equal(removeButton(tree, kind).props.disabled, false);
    assert.deepEqual(context.notifications, ['删除失败测试']);
    await removeButton(tree, kind).props.onClick(); assert.equal(calls, 2); assert.equal(context.requests.length, 2);
  }
});
