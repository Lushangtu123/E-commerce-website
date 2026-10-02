const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadPage, findElements } = require('./runtime.cjs');

const coupon = {
  coupon_id: 1, user_coupon_id: 7, name: 'Summer', code: 'SUMMER', type: 2, discount_value: 20,
  min_amount: 0, total_quantity: 10, remain_quantity: 5, per_user_limit: 1,
  status: 1, coupon_status: 1, received_at: '2026-01-01T00:00:00Z',
  start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z',
};
const auth = { isHydrated: true, isAuthenticated: true, user: { user_id: 1 } };

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree?.props ? textContent(tree.props.children) : '';
}

function setupPage(page, coupons = [coupon]) {
  return loadPage(`src/app/${page}/page.tsx`, { imports: {
    '@/lib/api': {
      couponApi: { getAvailable: async () => ({ data: coupons }), getMyCoupons: async () => ({ data: coupons }) },
      adminCouponApi: { getList: async () => ({ data: coupons }) },
    },
    '@/components/AdminLayout': ({ children }) => children,
  } });
}

test('my coupon use opens checkout carrying the exact user coupon ID', async () => {
  const runtime = setupPage('my/coupons');
  const tree = await runtime.flush(auth);

  findElements(tree, (element) => element.type === 'button' && element.props.children === '立即使用')[0].props.onClick();

  assert.deepEqual(runtime.redirects, ['/cart?user_coupon_id=7']);
});

test('disabled, expired or not-yet-active coupons cannot open checkout from my coupons', async () => {
  for (const changes of [
    { coupon_status: 0 },
    { expired_at: '2020-01-01T00:00:00Z' },
    { start_time: '2099-01-01T00:00:00Z' },
    { status: 2 },
    { status: 3 },
  ]) {
    const runtime = setupPage('my/coupons', [{ ...coupon, ...changes }]);
    const tree = await runtime.flush(auth);
    const buttons = findElements(tree, (element) => element.type === 'button' &&
      ['立即使用', '暂不可用'].includes(element.props.children));

    assert.ok(buttons.every((button) => button.props.disabled));
    for (const button of buttons) button.props.onClick();
    assert.deepEqual(runtime.redirects, []);
  }
});

test('all coupon cards display a twenty percent reduction as eight tenths payable', async () => {
  for (const page of ['coupons', 'my/coupons', 'admin/coupons']) {
    const runtime = setupPage(page);
    const tree = await runtime.flush(auth);

    assert.ok(textContent(tree).includes('8折'), `${page}: twenty percent off must display 8折`);
    assert.ok(!textContent(tree).includes('80折'), `${page}: percentages must not display as discount tenths`);
  }
});

test('MySQL decimal zero discount caps display as unlimited while positive caps are shown', async () => {
  for (const page of ['coupons', 'my/coupons']) {
    for (const cap of ['0.00', '5.00']) {
      const runtime = setupPage(page, [{ ...coupon, discount_value: '20.00', max_discount: cap }]);
      const tree = await runtime.flush(auth);
      assert.equal(textContent(tree).includes('最高优惠'), cap === '5.00', `${page}: cap=${cap}`);
      assert.ok(textContent(tree).includes('8折'));
    }
  }
});

test('my coupons reload for a new customer and discard a previous customer response', async () => {
  let finishFirst;
  const pending = new Promise(resolve => { finishFirst = resolve; });
  let calls = 0;
  const browser = createBrowser({ token: 'A' });
  const runtime = loadPage('src/app/my/coupons/page.tsx', { globals: browser, imports: {
    '@/lib/api': { couponApi: { getMyCoupons: () => ++calls === 1 ? pending : Promise.resolve({ data: [{ ...coupon, name: 'B的券' }] }) } },
  } });
  await runtime.flush({ ...auth, token: 'A' });
  browser.localStorage.setItem('token', 'B');
  let tree = await runtime.flush({ ...auth, token: 'B', user: { user_id: 2 } });
  assert.equal(calls, 2);
  assert.ok(textContent(tree).includes('B的券'));
  finishFirst({ data: [{ ...coupon, name: 'A的券' }] });
  await new Promise(setImmediate);
  tree = await runtime.flush();
  assert.ok(textContent(tree).includes('B的券'));
  assert.ok(!textContent(tree).includes('A的券'));
});

test('quick coupon status switches ignore the old filter response', async () => {
  let finishFirst;
  const pending = new Promise(resolve => { finishFirst = resolve; });
  const runtime = loadPage('src/app/my/coupons/page.tsx', { imports: {
    '@/lib/api': { couponApi: { getMyCoupons: (status) => status === 2 ? pending : Promise.resolve({ data: [{ ...coupon, status, name: status === 3 ? '已过期的券' : '未使用的券' }] }) } },
  } });
  let tree = await runtime.flush(auth);
  findElements(tree, element => element.type === 'button' && textContent(element).startsWith('已使用'))[0].props.onClick();
  // Retain the visible tabs' handler while the second request is in flight.
  const expiredTab = findElements(tree, element => element.type === 'button' && textContent(element).startsWith('已过期'))[0];
  await runtime.render();
  expiredTab.props.onClick();
  tree = await runtime.flush();
  assert.ok(textContent(tree).includes('已过期的券'));
  finishFirst({ data: [{ ...coupon, name: '旧筛选的券' }] });
  await new Promise(setImmediate);
  tree = await runtime.flush();
  assert.ok(textContent(tree).includes('已过期的券'));
  assert.ok(!textContent(tree).includes('旧筛选的券'));
});

test('a late coupon claim for the old customer cannot decrement the new customer list', async () => {
  let finishClaim;
  const pending = new Promise(resolve => { finishClaim = resolve; });
  const browser = createBrowser({ token: 'A' });
  const runtime = loadPage('src/app/coupons/page.tsx', { globals: browser, imports: {
    '@/lib/api': { couponApi: { getAvailable: async () => ({ data: [coupon] }), receive: () => pending } },
  } });
  let tree = await runtime.flush({ ...auth, token: 'A' });
  const button = findElements(tree, element => element.type === 'button' && textContent(element).includes('立即领取'))[0];
  const claim = button.props.onClick();
  browser.localStorage.setItem('token', 'B');
  tree = await runtime.flush({ ...auth, token: 'B', user: { user_id: 2 } });
  const before = textContent(tree);
  finishClaim({});
  await claim;
  tree = await runtime.flush();
  assert.equal(textContent(tree), before);
});
