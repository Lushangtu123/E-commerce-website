const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

const firstUser = { user_id: 1, username: 'first', email: 'first@test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@test' };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const displayedOrders = tree => findElements(tree, element => element.type === 'span' && text(element).startsWith('订单号: ')).map(element => text(element).slice(5));
const order = (id, status = 0, prefix = 'ORDER') => ({ order_id: id, order_no: `${prefix}-${id}`, status, total_amount: '10.00', created_at: '2026-10-02T00:00:00Z' });

function setup({ list, pay = async () => ({}), cancel = async () => ({}), confirmOrder = async () => ({}), search = '', confirm = () => true } = {}) {
  const stores = loadStores(); stores.useAuthStore.getState().login(firstUser, 'first-session'); stores.window.location.search = search;
  const requests = [], mutations = [], notifications = [];
  const all = Array.from({ length: 13 }, (_, index) => order(index + 1, index < 10 ? 0 : 4));
  const getList = list || (async params => {
    const filtered = params.status == null ? all : all.filter(item => item.status === params.status);
    return { orders: filtered.slice((params.page - 1) * params.limit, params.page * params.limit), total: filtered.length, page: params.page, limit: params.limit, totalPages: Math.ceil(filtered.length / params.limit) };
  });
  const toast = { error: message => notifications.push(message), success: message => notifications.push(message) };
  const runtime = loadPage('src/app/orders/page.tsx', { globals: { ...stores, confirm }, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    'react-hot-toast': { __esModule: true, default: toast, toast },
    '@/lib/api': { orderApi: {
      list: async params => { requests.push(JSON.parse(JSON.stringify(params))); return getList(params); },
      pay: async id => { mutations.push(['pay', id]); return pay(id); },
      cancel: async id => { mutations.push(['cancel', id]); return cancel(id); },
      confirm: async id => { mutations.push(['confirm', id]); return confirmOrder(id); },
    } },
  } });
  return { ...stores, runtime, requests, mutations, notifications };
}

test('thirteen orders use ten-row pages and cancellation filtering resets to page one', async () => {
  const context = setup(); let tree = await context.runtime.flush({});
  assert.deepEqual(context.requests, [{ page: 1, limit: 10 }]);
  assert.ok(text(tree).includes('共 13 个订单')); assert.deepEqual(displayedOrders(tree), Array.from({ length: 10 }, (_, index) => `ORDER-${index + 1}`));
  assert.equal(button(tree, '上一页').props.disabled, true); assert.equal(button(tree, '下一页').props.disabled, false);
  button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(context.requests.at(-1), { page: 2, limit: 10 });
  assert.deepEqual(displayedOrders(tree), ['ORDER-11', 'ORDER-12', 'ORDER-13']);
  assert.equal(button(tree, '下一页').props.disabled, true);
  button(tree, '已取消').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(context.requests.at(-1), { page: 1, limit: 10, status: 4 });
  assert.ok(text(tree).includes('共 3 个订单')); assert.ok(text(tree).includes('第 1 / 1 页'));
  assert.equal(button(tree, '上一页').props.disabled, true);
});

test('profile status links initialize a legal filter once and malformed statuses use all orders', async () => {
  for (const value of ['0', '1', '2', '3', '4', '5', '-1', '00', 'NaN', '']) {
    const context = setup({ search: `?status=${value}` }); await context.runtime.flush({});
    assert.deepEqual(context.requests, [{ page: 1, limit: 10, ...(/^[0-4]$/.test(value) && { status: Number(value) }) }], value);
  }
});

test('filter and page changes hide old rows immediately and quick filters reject late results or errors', async () => {
  for (const outcome of ['success', 'failure']) {
    let finish, fail; const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const context = setup({ list: async params => params.status === 0 ? pending : { orders: [order(1, params.status ?? 3, params.status === 4 ? 'CANCELLED' : 'ALL')], total: 13, page: params.page, limit: 10, totalPages: 2 } });
    let tree = await context.runtime.flush({}); assert.deepEqual(displayedOrders(tree), ['ALL-1']);
    button(tree, '下一页').props.onClick(); tree = await context.runtime.render(); assert.deepEqual(displayedOrders(tree), []);
    tree = await context.runtime.flush();
    button(tree, '待支付').props.onClick(); tree = await context.runtime.render(); assert.deepEqual(displayedOrders(tree), []);
    tree = await context.runtime.flush(); button(tree, '已取消').props.onClick(); tree = await context.runtime.flush();
    assert.deepEqual(displayedOrders(tree), ['CANCELLED-1']);
    if (outcome === 'success') finish({ orders: [order(99, 0, 'LATE')], total: 1, totalPages: 1 }); else fail(new Error('Late unavailable'));
    await new Promise(setImmediate); tree = await context.runtime.flush();
    assert.deepEqual(displayedOrders(tree), ['CANCELLED-1']); assert.deepEqual(context.notifications, []);
  }
});

test('customer changes immediately hide loaded or pending old results and reset filter and page', async () => {
  for (const previousState of ['loaded', 'pending']) {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    let context;
    context = setup({ list: async params => {
      if (context.useAuthStore.getState().token === 'second-session') return { orders: [order(1, 3, 'SECOND')], total: 1, totalPages: 1 };
      if (previousState === 'pending' && params.page === 2) return pending;
      return { orders: [order(1, 0, 'FIRST')], total: 13, totalPages: 2 };
    }, search: '?status=0' });
    let tree = await context.runtime.flush({}); button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
    context.useAuthStore.getState().login(secondUser, 'second-session');
    tree = await context.runtime.render(); assert.deepEqual(displayedOrders(tree), []);
    tree = await context.runtime.flush();
    assert.deepEqual(context.requests.at(-1), { page: 1, limit: 10 }); assert.deepEqual(displayedOrders(tree), ['SECOND-1']);
    finish({ orders: [order(99, 0, 'LATE-FIRST')], total: 99, totalPages: 10 }); await new Promise(setImmediate); tree = await context.runtime.flush();
    assert.deepEqual(displayedOrders(tree), ['SECOND-1']);
  }
});

test('failed lists display a retry error instead of an empty history and recover on retry', async () => {
  let calls = 0;
  const context = setup({ list: async () => {
    if (++calls === 1) throw { response: { data: { error: '订单服务暂不可用' } } };
    return { orders: [order(1)], total: 1, totalPages: 1 };
  } });
  let tree = await context.runtime.flush({});
  assert.ok(text(tree).includes('订单服务暂不可用')); assert.ok(!text(tree).includes('暂无订单'));
  await button(tree, '重新加载').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(displayedOrders(tree), ['ORDER-1']); assert.equal(context.requests.length, 2);
});

test('same order pending actions reject duplicate pay or cancel and refresh only after payment succeeds', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const context = setup({ pay: () => pending }); let tree = await context.runtime.flush({});
  const pay = button(tree, '立即支付'); const cancel = button(tree, '取消订单');
  const work = pay.props.onClick(); const duplicate = pay.props.onClick(); const conflicting = cancel.props.onClick();
  assert.deepEqual(context.mutations, [['pay', 1]]);
  tree = await context.runtime.flush(); assert.ok(findElements(tree, element => element.type === 'button' && ['立即支付', '取消订单', '确认收货'].includes(text(element))).every(element => element.props.disabled));
  assert.equal(context.requests.length, 1);
  finish({}); await Promise.all([work, duplicate, conflicting]); await context.runtime.flush();
  assert.equal(context.requests.length, 2); assert.deepEqual(context.notifications, ['支付成功']);
});

test('canceling the only order on the final filtered page returns to the remaining last page', async () => {
  let cancelled = false;
  const context = setup({ search: '?status=0', cancel: async () => { cancelled = true; }, list: async params => {
    const total = cancelled ? 10 : 11;
    return { orders: Array.from({ length: params.page === 1 ? 10 : cancelled ? 0 : 1 }, (_, index) => order((params.page - 1) * 10 + index + 1)), total, page: params.page, limit: 10, totalPages: Math.ceil(total / 10) };
  } });
  let tree = await context.runtime.flush({}); button(tree, '下一页').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(displayedOrders(tree), ['ORDER-11']); await button(tree, '取消订单').props.onClick(); tree = await context.runtime.flush();
  assert.deepEqual(context.requests.slice(-2), [{ page: 2, limit: 10, status: 0 }, { page: 1, limit: 10, status: 0 }]);
  assert.equal(displayedOrders(tree).length, 10); assert.ok(text(tree).includes('第 1 / 1 页')); assert.ok(!text(tree).includes('暂无订单'));
});

test('old action handlers cannot send mutations after a filter change or another tab token change', async () => {
  for (const action of ['pay', 'cancel', 'confirm']) {
    for (const change of ['filter', 'storage']) {
      const context = setup({ list: async () => ({ orders: [order(1, action === 'confirm' ? 2 : 0)], total: 1, totalPages: 1 }) });
      let tree = await context.runtime.flush({}); const oldAction = button(tree, action === 'pay' ? '立即支付' : action === 'cancel' ? '取消订单' : '确认收货');
      if (change === 'filter') { button(tree, '已取消').props.onClick(); await context.runtime.flush(); }
      else context.localStorage.setItem('token', 'other-tab-session');
      await oldAction.props.onClick(); assert.deepEqual(context.mutations, [], `${action}/${change}`);
    }
  }
});

test('late mutation success or failure after account, storage or unmount changes cannot refresh, notify or touch the cart', async () => {
  for (const action of ['pay', 'cancel', 'confirm']) {
    for (const change of ['account', 'storage', 'unmount']) {
      for (const outcome of ['success', 'failure']) {
        let finish, fail; const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        const context = setup({ pay: () => pending, cancel: () => pending, confirmOrder: () => pending,
          list: async () => ({ orders: [order(1, action === 'confirm' ? 2 : 0)], total: 1, totalPages: 1 }) });
        const tree = await context.runtime.flush({}); const work = button(tree, action === 'pay' ? '立即支付' : action === 'cancel' ? '取消订单' : '确认收货').props.onClick();
        if (change === 'account') { context.useAuthStore.getState().login(secondUser, 'second-session'); await context.runtime.flush(); }
        if (change === 'storage') context.localStorage.setItem('token', 'other-tab-session');
        if (change === 'unmount') context.runtime.unmount();
        context.useCartStore.getState().setItems([{ cart_id: 1, product_id: 1, title: 'Current cart', quantity: 2, price: 10, stock: 4 }]);
        const lists = context.requests.length;
        if (outcome === 'success') finish({}); else fail({ response: { data: { error: '旧操作失败' } } });
        await work;
        assert.equal(context.requests.length, lists, `${action}/${change}/${outcome}`);
        assert.deepEqual(context.notifications, []); assert.deepEqual(context.runtime.redirects, []);
        assert.equal(context.useCartStore.getState().getTotalCount(), 2);
      }
    }
  }
});

test('a mutation finishing after filter or page changes refreshes the current query without restoring the old scope', async () => {
  for (const change of ['filter', 'page']) {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    const context = setup({ pay: () => pending, list: async params => ({ orders: [order(params.page, params.status ?? 0, `${params.status === 4 ? 'CANCELLED' : 'ALL'}-PAGE${params.page}`)], total: 13, totalPages: 2 }) });
    let tree = await context.runtime.flush({}); const work = button(tree, '立即支付').props.onClick();
    button(tree, change === 'filter' ? '已取消' : '下一页').props.onClick(); tree = await context.runtime.flush();
    const expected = change === 'filter' ? { page: 1, limit: 10, status: 4 } : { page: 2, limit: 10 };
    assert.deepEqual(context.requests.at(-1), expected); finish({}); await work; tree = await context.runtime.flush();
    assert.deepEqual(context.requests.at(-1), expected); assert.equal(context.requests.length, 3);
    assert.deepEqual(displayedOrders(tree), [change === 'filter' ? 'CANCELLED-PAGE1-1' : 'ALL-PAGE2-2']);
  }
});

test('cancel confirmation is checked before and after the prompt and canceled prompts issue no request', async () => {
  for (const change of ['decline', 'account']) {
    let context; context = setup({ confirm: () => { if (change === 'account') context.useAuthStore.getState().login(secondUser, 'second-session'); return change !== 'decline'; } });
    const tree = await context.runtime.flush({}); await button(tree, '取消订单').props.onClick(); assert.deepEqual(context.mutations, []);
  }
});

test('a late list after leaving the page or changing browser credentials cannot notify or become visible', async () => {
  for (const change of ['unmount', 'storage']) {
    for (const outcome of ['success', 'failure']) {
      let finish, fail; const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      const context = setup({ list: () => pending }); await context.runtime.flush({});
      if (change === 'unmount') context.runtime.unmount(); else context.localStorage.setItem('token', 'other-tab-session');
      if (outcome === 'success') finish({ orders: [order(99, 0, 'LATE')], total: 1, totalPages: 1 }); else fail({ response: { data: { error: '旧列表错误' } } });
      await new Promise(setImmediate); assert.deepEqual(context.notifications, []);
      if (change === 'storage') { const tree = await context.runtime.flush(); assert.deepEqual(displayedOrders(tree), []); assert.ok(!text(tree).includes('旧列表错误')); }
    }
  }
});

test('a failed payment keeps the current orders, reports the server error and releases pending actions for retry', async () => {
  let fail = true;
  const context = setup({ pay: async () => { if (fail) throw { response: { data: { error: '订单已过期' } } }; } });
  let tree = await context.runtime.flush({}); await button(tree, '立即支付').props.onClick(); tree = await context.runtime.flush();
  assert.ok(context.notifications.includes('订单已过期')); assert.equal(context.requests.length, 1);
  assert.equal(button(tree, '立即支付').props.disabled, false); assert.equal(displayedOrders(tree).length, 10);
  fail = false; await button(tree, '立即支付').props.onClick(); assert.equal(context.requests.length, 2);
});

test('only unpaid orders expose pay and cancel, while only shipped orders expose confirmation', async () => {
  const context = setup({ list: async () => ({ orders: [0, 1, 2, 3, 4].map(status => order(status + 1, status)), total: 5, totalPages: 1 }) });
  const tree = await context.runtime.flush({});
  const actions = findElements(tree, element => element.type === 'button' && ['立即支付', '取消订单', '确认收货'].includes(text(element)));
  assert.deepEqual(actions.map(text), ['立即支付', '取消订单', '确认收货']);
  await actions[2].props.onClick(); assert.deepEqual(context.mutations, [['confirm', 3]]);
});
