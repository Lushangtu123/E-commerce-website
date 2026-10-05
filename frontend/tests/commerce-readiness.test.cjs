const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, node => node.type === 'button' && text(node) === label)[0];
const settings = { mode: 'disabled', canPay: false, isDemo: false };
function ordersContext(getSettings = async () => settings) {
  const stores = loadStores(); stores.useAuthStore.getState().login({ user_id: 1, username: 'Customer', email: 'c@test' }, 'session');
  const mutations = [], notices = [];
  const runtime = loadPage('src/app/orders/page.tsx', { globals: stores, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    '@/lib/api': { paymentApi: { getSettings }, orderApi: { list: async () => ({ orders: [{ order_id: 1, order_no: 'ORDER-1', status: 0, total_amount: 10 }], total: 1, totalPages: 1 }), pay: async id => mutations.push(id) } },
    'react-hot-toast': { __esModule: true, default: { success: value => notices.push(value), error: value => notices.push(value) } },
  } });
  return { ...stores, runtime, mutations, notices };
}

test('disabled, unavailable, or inconsistent payment settings never expose a payment action', async () => {
  for (const getSettings of [async () => settings, async () => { throw new Error('Offline'); }, async () => ({ mode: 'disabled', canPay: true, isDemo: false })]) {
    const context = ordersContext(getSettings); const tree = await context.runtime.flush();
    assert.equal(button(tree, '立即支付'), undefined); assert.equal(button(tree, '模拟支付'), undefined);
    assert.ok(text(tree).includes('暂未开通在线支付')); assert.deepEqual(context.mutations, []);
  }
});

test('explicit demo mode labels its action and success without suggesting real money was collected', async () => {
  const context = ordersContext(async () => ({ mode: 'demo', canPay: true, isDemo: true }));
  const tree = await context.runtime.flush();
  assert.ok(text(tree).includes('不会实际扣款')); assert.equal(button(tree, '立即支付'), undefined);
  await button(tree, '模拟支付').props.onClick();
  assert.deepEqual(context.mutations, [1]); assert.deepEqual(context.notices, ['模拟支付完成，未实际扣款']);
});
