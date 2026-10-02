const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadPage, findElements } = require('./runtime.cjs');

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree?.props ? textContent(tree.props.children) : '';
}

function amountRow(tree, label) {
  return findElements(tree, (element) => element.type === 'div' &&
    Array.isArray(element.props.children) && element.props.children[0]?.props?.children === label)[0];
}

function setupDetail(order) {
  return loadPage('src/app/orders/[id]/page.tsx', {
    globals: { setInterval: () => 1, clearInterval() {} },
    imports: { '@/lib/api': {
      orderApi: { getDetail: async () => ({ order, items: [] }) },
      orderTimeoutApi: { getRemainingTime: async () => ({ remaining_minutes: 10 }) },
    } },
  });
}

const auth = { isHydrated: true, isAuthenticated: true, user: { user_id: 1 } };

test('order detail displays the original price, coupon reduction and charged total separately', async () => {
  const runtime = setupDetail({ status: 3, original_amount: '100.00', discount_amount: '20.00', total_amount: '80.00',
    user_coupon_id: 7, coupon_name: 'Summer', coupon_code: 'SUMMER', created_at: '2026-10-02T00:00:00Z' });

  const tree = await runtime.flush(auth);

  assert.equal(textContent(amountRow(tree, '商品总价')), '商品总价¥100.00');
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥20.00');
  assert.equal(textContent(amountRow(tree, '实付款')), '实付款¥80.00');
  assert.ok(textContent(tree).includes('Summer'));
  assert.ok(textContent(tree).includes('SUMMER'));
});

test('legacy orders fall back to total price and zero coupon reduction', async () => {
  const runtime = setupDetail({ status: 3, original_amount: null, total_amount: '35.00', created_at: '2026-10-02T00:00:00Z' });

  const tree = await runtime.flush(auth);

  assert.equal(textContent(amountRow(tree, '商品总价')), '商品总价¥35.00');
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥0.00');
  assert.equal(textContent(amountRow(tree, '实付款')), '实付款¥35.00');
});

test('unpaid orders label their final price as payable instead of already charged', async () => {
  const runtime = setupDetail({ status: 0, original_amount: 100, discount_amount: 20, total_amount: 80, created_at: '2026-10-02T00:00:00Z' });

  const tree = await runtime.flush(auth);

  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥80.00');
  assert.equal(amountRow(tree, '实付款'), undefined);
});

test('order detail rechecks ownership on a customer change and ignores an earlier detail response', async () => {
  let finishA;
  const pending = new Promise(resolve => { finishA = resolve; });
  const browser = createBrowser({ token: 'A' });
  let calls = 0;
  const runtime = loadPage('src/app/orders/[id]/page.tsx', { globals: browser, imports: {
    '@/lib/api': { orderApi: { getDetail: () => ++calls === 1 ? pending : Promise.resolve({ order: { status: 3, order_no: 'B订单', total_amount: 5 }, items: [] }) } },
  } });
  await runtime.flush({ ...auth, token: 'A' });
  browser.localStorage.setItem('token', 'B');
  let tree = await runtime.flush({ ...auth, token: 'B', user: { user_id: 2 } });
  assert.equal(calls, 2);
  assert.ok(textContent(tree).includes('B订单'));
  finishA({ order: { status: 3, order_no: 'A订单', total_amount: 100 }, items: [] });
  await new Promise(setImmediate);
  tree = await runtime.flush();
  assert.ok(textContent(tree).includes('B订单'));
  assert.ok(!textContent(tree).includes('A订单'));
});

test('an old detail page payment handler cannot issue a request for another browser tab account', async () => {
  const browser = createBrowser({ token: 'A' });
  let payments = 0;
  const runtime = loadPage('src/app/orders/[id]/page.tsx', {
    globals: { ...browser, setInterval: () => 1, clearInterval() {} },
    imports: { '@/lib/api': {
      orderApi: { getDetail: async () => ({ order: { status: 0, total_amount: 10 }, items: [] }), pay: async () => { payments++; } },
      orderTimeoutApi: { getRemainingTime: async () => ({ remaining_minutes: 10 }) },
    } },
  });
  const tree = await runtime.flush({ ...auth, token: 'A' });
  const pay = findElements(tree, element => element.type === 'button' && textContent(element) === '立即支付')[0];
  browser.localStorage.setItem('token', 'B');
  await pay.props.onClick();
  assert.equal(payments, 0);
});
