const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, createBrowser, findElements } = require('./runtime.cjs');
const stats = { totalOrders: 17, pendingOrders: 3, totalCoupons: 11, availableCoupons: 4, favoriteCount: 8 };
const auth = { isHydrated: true, isAuthenticated: true, token: 'A', user: { user_id: 1, username: 'Customer A', email: 'a@example.test' } };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, name) => findElements(tree, node => node.type === 'button' && text(node) === name)[0];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(getStats = async () => ({ stats })) {
  const browser = createBrowser({ token: 'A' });
  const calls = [];
  const runtime = loadPage('src/app/profile/page.tsx', { globals: browser, imports: {
    '@/lib/api': { userApi: { getStats: () => { calls.push('stats'); return getStats(); } }, couponApi: { getMyCoupons: async () => ({ data: [] }) } },
  } });
  return { browser, calls, runtime };
}

test('profile displays server order, coupon and favorite counts and links pending orders to their filter', async () => {
  const { runtime, calls } = setup();
  const tree = await runtime.flush(auth);
  for (const [label, count] of [['我的订单', 17], ['可用优惠券', 4], ['我的收藏', 8], ['待支付', 3]]) {
    const cards = findElements(tree, node => Array.isArray(node.props.children) && node.props.children[1]?.props?.children === label);
    assert.ok(cards.some(card => text(card.props.children[0]) === String(count)), `${label} should show ${count}`);
  }
  assert.deepEqual(calls, ['stats']);
  assert.ok(findElements(tree, node => node.props.href === '/orders?status=0').length);
  assert.ok(text(tree).includes('11'));
});

test('failed profile counts show an error instead of fabricated zero values and retry loads accurate counts', async () => {
  let attempts = 0;
  const { runtime } = setup(async () => { if (++attempts === 1) throw new Error('offline'); return { stats }; });
  let tree = await runtime.flush(auth);
  assert.ok(text(tree).includes('统计数据加载失败'));
  assert.ok(text(tree).includes('—'));
  button(tree, '重新加载统计').props.onClick(); tree = await runtime.flush();
  assert.equal(attempts, 2); assert.ok(text(tree).includes('17')); assert.ok(!text(tree).includes('统计数据加载失败'));
});

test('changing customers hides loaded profile counts in the first render and ignores late previous counts', async () => {
  const previous = deferred(); let attempts = 0;
  const { runtime, browser } = setup(() => ++attempts === 1 ? previous.promise : Promise.resolve({ stats: { ...stats, totalOrders: 29 } }));
  await runtime.flush(auth);
  browser.localStorage.setItem('token', 'B');
  let tree = await runtime.flush({ ...auth, token: 'B', user: { user_id: 2, username: 'Customer B' } });
  assert.equal(attempts, 2); assert.ok(text(tree).includes('29'));
  previous.resolve({ stats }); await new Promise(setImmediate); tree = await runtime.flush();
  assert.ok(text(tree).includes('29')); assert.ok(!text(tree).includes('Customer A'));

  const next = deferred(); const second = setup(() => next.promise);
  next.resolve({ stats }); await second.runtime.flush(auth);
  second.browser.localStorage.setItem('token', 'B');
  tree = await second.runtime.render({ ...auth, token: 'B', user: { user_id: 2 } });
  assert.ok(!text(tree).includes('17'));
});

test('profile ignores late failures after account change and success after leaving the page', async () => {
  const old = deferred(); let attempts = 0;
  const { runtime, browser } = setup(() => ++attempts === 1 ? old.promise : Promise.resolve({ stats: { ...stats, totalOrders: 29 } }));
  await runtime.flush(auth); browser.localStorage.setItem('token', 'B');
  await runtime.flush({ ...auth, token: 'B', user: { user_id: 2 } });
  old.reject(new Error('old failure')); await new Promise(setImmediate);
  assert.ok(!text(await runtime.flush()).includes('统计数据加载失败'));
  const pending = deferred(); const other = setup(() => pending.promise);
  await other.runtime.flush(auth); other.runtime.unmount(); pending.resolve({ stats }); await new Promise(setImmediate);
  assert.ok(!text(await other.runtime.render()).includes('17'));
});

test('a stale profile retry cannot load another browser tab customer before hydration catches up', async () => {
  const { runtime, browser, calls } = setup(async () => { throw new Error('offline'); });
  const tree = await runtime.flush(auth); browser.localStorage.setItem('token', 'B');
  button(tree, '重新加载统计').props.onClick(); await runtime.flush();
  assert.deepEqual(calls, ['stats']);
});
