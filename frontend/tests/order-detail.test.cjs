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

function setupDetail(order, items = []) {
  return loadPage('src/app/orders/[id]/page.tsx', {
    globals: { setInterval: () => 1, clearInterval() {} },
    imports: { '@/lib/api': { paymentApi: { getSettings: async () => ({ mode: 'demo', canPay: true, isDemo: true }) },
      orderApi: { getDetail: async () => ({ order, items }) },
      orderTimeoutApi: { getRemainingTime: async () => ({ remaining_minutes: 10 }) },
    } },
  });
}

const auth = { isHydrated: true, isAuthenticated: true, user: { user_id: 1 } };

test('customer order detail renders the original shipping snapshot and identifies legacy orders without one', async () => {
  const shipping_address_snapshot = { receiver_name: 'Original Receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '旧地址 1 号' };
  let tree = await setupDetail({ status: 3, total_amount: 50, shipping_address_snapshot, receiver_name: 'Current Address Receiver', detail_address: '新地址' }).flush(auth);
  assert.ok(textContent(tree).includes('Original Receiver')); assert.ok(textContent(tree).includes('13800138000'));
  assert.ok(textContent(tree).includes('浙江省杭州市西湖区旧地址 1 号'));
  assert.ok(!textContent(tree).includes('Current Address Receiver'));
  tree = await setupDetail({ status: 3, total_amount: 50, shipping_address_snapshot: null }).flush(auth);
  assert.ok(textContent(tree).includes('历史订单未记录收货信息'));
});

test('order detail shows the purchased SKU snapshot for each variant separately', async () => {
  const runtime = setupDetail({ status: 3, total_amount: 50 }, [
    { item_id: 1, product_name: 'Shirt', price: 20, quantity: 1, sku_id: 101, sku_code: 'OLD-RED', sku_specs: { Color: 'Red', Size: 'M' } },
    { item_id: 2, product_name: 'Shirt', price: 30, quantity: 1, sku_id: 102, sku_code: 'OLD-BLUE', sku_specs: { Color: 'Blue', Size: 'L' } },
  ]);
  const tree = await runtime.flush(auth);
  assert.ok(textContent(tree).includes('Color: Red / Size: M'));
  assert.ok(textContent(tree).includes('Color: Blue / Size: L'));
  assert.ok(textContent(tree).includes('OLD-RED'));
  assert.ok(textContent(tree).includes('OLD-BLUE'));
});

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
    imports: { '@/lib/api': { paymentApi: { getSettings: async () => ({ mode: 'demo', canPay: true, isDemo: true }) },
      orderApi: { getDetail: async () => ({ order: { status: 0, total_amount: 10 }, items: [] }), pay: async () => { payments++; } },
      orderTimeoutApi: { getRemainingTime: async () => ({ remaining_minutes: 10 }) },
    } },
  });
  const tree = await runtime.flush({ ...auth, token: 'A' });
  const pay = findElements(tree, element => element.type === 'button' && textContent(element) === '模拟支付')[0];
  browser.localStorage.setItem('token', 'B');
  await pay.props.onClick();
  assert.equal(payments, 0);
});
