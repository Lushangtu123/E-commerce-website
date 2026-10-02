const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const firstItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'Product', price: 10, stock: 5 };
const coupon = { user_coupon_id: 7, name: 'Summer', code: 'SUMMER', discount_amount: 20 };

function quote(total = 90, selectedCoupon = false) {
  return {
    original_amount: total, discount_amount: selectedCoupon ? 20 : 0,
    total_amount: selectedCoupon ? total - 20 : total,
    coupon: selectedCoupon ? coupon : null, available_coupons: [coupon],
  };
}

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree?.props ? textContent(tree.props.children) : '';
}

function amountRow(tree, label) {
  return findElements(tree, (element) => element.type === 'div' &&
    Array.isArray(element.props.children) && element.props.children[0]?.props?.children === label)[0];
}

function checkoutButton(tree) {
  return findElements(tree, (element) => element.type === 'button' && textContent(element).includes('结算 ('))[0];
}

function setupCheckout({ preview = async () => quote(), create = async () => ({ order_id: 55 }), cartItems = [firstItem], search = '',
  updateQuantity = async () => ({}), remove = async () => ({}) } = {}) {
  const stores = loadStores();
  stores.window.location.search = search;
  stores.useAuthStore.getState().login(firstUser, 'first-session');
  const previews = [];
  const creates = [];
  const notifications = [];
  const toast = { error: (message) => notifications.push(message), success() {} };
  const runtime = loadPage('src/app/cart/page.tsx', {
    globals: { ...stores },
    imports: {
      '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
      '@/store/useCartStore': { useCartStore: () => stores.useCartStore.getState() },
      'react-hot-toast': { __esModule: true, default: toast, toast },
      '@/lib/api': {
        cartApi: { list: async () => ({ items: cartItems }), updateQuantity, remove },
        orderApi: {
          preview: async (input) => { previews.push(JSON.parse(JSON.stringify(input))); return preview(input); },
          create: async (input) => { creates.push(JSON.parse(JSON.stringify(input))); return create(input); },
        },
      },
    },
  });
  return { ...stores, runtime, previews, creates, notifications };
}

test('checkout defaults to no coupon and displays the server product price and payable amount', async () => {
  const { runtime, previews } = setupCheckout();

  const tree = await runtime.flush({});

  assert.deepEqual(previews, [{ items: [{ product_id: 12, quantity: 3 }] }]);
  const selector = findElements(tree, (element) => element.type === 'select')[0];
  assert.equal(selector.props.value, '');
  assert.deepEqual(findElements(selector, (element) => element.type === 'option').map((element) => element.props.value), ['', 7]);
  assert.equal(textContent(amountRow(tree, '商品总价')), '商品总价¥90.00');
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥0.00');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥90.00');
});

test('selecting a coupon requotes the order and submits only its ID with selected product quantities', async () => {
  const { runtime, previews, creates } = setupCheckout({ preview: async (input) => quote(90, input.user_coupon_id === 7) });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'select')[0].props.onChange({ target: { value: '7' } });

  tree = await runtime.flush();
  assert.equal(previews.at(-1).user_coupon_id, 7);
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥20.00');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥70.00');
  await findElements(tree, (element) => element.type === 'button' && textContent(element).includes('结算 ('))[0].props.onClick();

  assert.deepEqual(creates, [{ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7 }]);
  assert.deepEqual(runtime.redirects, ['/orders/55']);
});

test('checkout stays disabled while a preview is loading or failed and can retry the server quote', async () => {
  let failPreview;
  let previews = 0;
  const pending = new Promise((resolve, reject) => { failPreview = reject; });
  const { runtime, creates } = setupCheckout({ preview: () => ++previews === 1 ? pending : Promise.resolve(quote()) });
  let tree = await runtime.flush({});

  assert.equal(checkoutButton(tree).props.disabled, true);
  await checkoutButton(tree).props.onClick();
  assert.deepEqual(creates, []);
  failPreview(Object.assign(new Error('Unavailable'), { response: { data: { error: '商品库存不足' } } }));
  await new Promise(setImmediate);
  tree = await runtime.flush();
  assert.equal(checkoutButton(tree).props.disabled, true);
  assert.ok(textContent(tree).includes('商品库存不足'));

  await findElements(tree, (element) => element.type === 'button' && textContent(element) === '重新计算')[0].props.onClick();
  tree = await runtime.flush();
  assert.equal(checkoutButton(tree).props.disabled, false);
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥90.00');
});

test('quantity changes request a new quote and a late previous quote cannot replace its amount', async () => {
  let finishFirstPreview;
  const firstPreview = new Promise((resolve) => { finishFirstPreview = resolve; });
  const { runtime, previews } = setupCheckout({ preview: (input) => input.items[0].quantity === 3 ? firstPreview : Promise.resolve(quote(120)) });
  let tree = await runtime.flush({});
  await findElements(tree, (element) => element.type === 'button' && element.props.children === '+')[0].props.onClick();
  tree = await runtime.flush();
  assert.deepEqual(previews.at(-1), { items: [{ product_id: 12, quantity: 4 }] });
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥120.00');

  finishFirstPreview(quote(90));
  await new Promise(setImmediate);
  tree = await runtime.flush();

  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥120.00');
});

test('changing selected items immediately invalidates the previous quote before the next effect runs', async () => {
  const secondItem = { ...firstItem, cart_id: 2, product_id: 22, quantity: 1 };
  const { runtime, previews, creates } = setupCheckout({
    cartItems: [firstItem, secondItem],
    preview: (input) => input.items.length === 2 ? Promise.resolve(quote(120)) : new Promise(() => {}),
  });
  let tree = await runtime.flush({});
  assert.equal(checkoutButton(tree).props.disabled, false);
  findElements(tree, (element) => element.type === 'input' && element.props.type === 'checkbox')[2].props.onChange();

  tree = await runtime.render();

  assert.equal(checkoutButton(tree).props.disabled, true);
  assert.ok(!textContent(amountRow(tree, '应付金额')).includes('120.00'));
  await checkoutButton(tree).props.onClick();
  assert.deepEqual(creates, []);
  assert.deepEqual(previews.at(-1), { items: [{ product_id: 12, quantity: 3 }] });
});

test('a valid coupon carried from my coupons is selected once and can then be removed', async () => {
  const { runtime, previews } = setupCheckout({ search: '?user_coupon_id=7', preview: async (input) => quote(90, input.user_coupon_id === 7) });
  let tree = await runtime.flush({});

  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, 7);
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥70.00');
  assert.deepEqual(previews.map((input) => input.user_coupon_id), [undefined, 7]);
  findElements(tree, (element) => element.type === 'select')[0].props.onChange({ target: { value: '' } });
  tree = await runtime.flush();

  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, '');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥90.00');
});

test('unavailable carried coupons are reported and never sent to preview or checkout', async () => {
  const { runtime, previews, notifications } = setupCheckout({ search: '?user_coupon_id=999' });

  const tree = await runtime.flush({});

  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, '');
  assert.ok(notifications.includes('所选优惠券当前不可用，请重新选择'));
  assert.deepEqual(previews, [{ items: [{ product_id: 12, quantity: 3 }] }]);
});

test('an expired selected coupon shows the server error and refreshes available coupons without it', async () => {
  let available = true;
  const { runtime, previews, notifications } = setupCheckout({ preview: async (input) => {
    if (input.user_coupon_id) {
      available = false;
      throw Object.assign(new Error('Expired'), { response: { data: { error: '优惠券已过期' } } });
    }
    return { ...quote(), available_coupons: available ? [coupon] : [] };
  } });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'select')[0].props.onChange({ target: { value: '7' } });

  tree = await runtime.flush();

  assert.ok(notifications.includes('优惠券已过期'));
  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, '');
  assert.equal(findElements(tree, (element) => element.type === 'option').length, 1);
  assert.deepEqual(previews.map((input) => input.user_coupon_id), [undefined, 7, undefined]);
  assert.equal(checkoutButton(tree).props.disabled, false);
});

test('successful checkout removes only purchased rows and leaves unselected products in the cart', async () => {
  const secondItem = { ...firstItem, cart_id: 2, product_id: 22, quantity: 1 };
  const { runtime, creates, useCartStore } = setupCheckout({ cartItems: [firstItem, secondItem] });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'input' && element.props.type === 'checkbox')[2].props.onChange();
  tree = await runtime.flush();

  await checkoutButton(tree).props.onClick();

  assert.deepEqual(creates, [{ items: [{ product_id: 12, quantity: 3 }] }]);
  assert.deepEqual(useCartStore.getState().items.map((item) => item.product_id), [22]);
  assert.equal(useCartStore.getState().getTotalCount(), 1);
  assert.deepEqual(runtime.redirects, ['/orders/55']);
});

test('a late checkout success or failure for customer A never changes customer B cart or navigation', async () => {
  for (const outcome of ['success', 'failure']) {
    let finishOrder;
    let failOrder;
    const pendingOrder = new Promise((resolve, reject) => { finishOrder = resolve; failOrder = reject; });
    const { runtime, useAuthStore, useCartStore, notifications } = setupCheckout({ create: () => pendingOrder });
    let tree = await runtime.flush({});
    const submission = checkoutButton(tree).props.onClick();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(secondUser, 'second-session');
    tree = await runtime.flush();
    assert.equal(useCartStore.getState().items.length, 1);

    if (outcome === 'success') finishOrder({ order_id: 55 });
    else failOrder(Object.assign(new Error('Expired'), { response: { data: { error: 'A优惠券已过期' } } }));
    await submission;

    assert.equal(useCartStore.getState().items.length, 1, `${outcome}: B cart must remain`);
    assert.deepEqual(runtime.redirects, []);
    assert.ok(!notifications.includes('A优惠券已过期'));
  }
});

test('changing customer clears coupon choice and pending submission state before requoting the new cart', async () => {
  const { runtime, previews, useAuthStore } = setupCheckout({
    preview: async (input) => quote(90, input.user_coupon_id === 7), create: () => new Promise(() => {}),
  });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'select')[0].props.onChange({ target: { value: '7' } });
  tree = await runtime.flush();
  checkoutButton(tree).props.onClick();

  useAuthStore.getState().login(secondUser, 'second-session');
  tree = await runtime.flush();

  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, '');
  assert.equal(previews.at(-1).user_coupon_id, undefined);
  assert.equal(checkoutButton(tree).props.disabled, false);
});

test('a coupon rejected during order creation keeps the cart and refreshes the server choices', async () => {
  let available = true;
  const { runtime, useCartStore, notifications, previews } = setupCheckout({
    preview: async (input) => ({ ...quote(90, input.user_coupon_id === 7), available_coupons: available ? [coupon] : [] }),
    create: async () => {
      available = false;
      throw Object.assign(new Error('Expired'), { response: { data: { error: '优惠券已被使用' } } });
    },
  });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'select')[0].props.onChange({ target: { value: '7' } });
  tree = await runtime.flush();

  await checkoutButton(tree).props.onClick();
  tree = await runtime.flush();

  assert.ok(notifications.includes('优惠券已被使用'));
  assert.equal(useCartStore.getState().items.length, 1);
  assert.deepEqual(runtime.redirects, []);
  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, '');
  assert.equal(previews.at(-1).user_coupon_id, undefined);
  assert.equal(findElements(tree, (element) => element.type === 'option').length, 1);
});

test('repeated checkout clicks while a submission is pending create only one order', async () => {
  let finishOrder;
  const pendingOrder = new Promise((resolve) => { finishOrder = resolve; });
  const { runtime, creates } = setupCheckout({ create: () => pendingOrder });
  const tree = await runtime.flush({});
  const button = checkoutButton(tree);

  const firstSubmission = button.props.onClick();
  const repeatedSubmission = button.props.onClick();
  assert.equal(creates.length, 1);
  finishOrder({ order_id: 55 });
  await Promise.all([firstSubmission, repeatedSubmission]);
});

test('late cart quantity or removal responses cannot modify the next customer cart or selection', async () => {
  for (const operation of ['quantity', 'remove']) {
    let finishMutation;
    const pendingMutation = new Promise((resolve) => { finishMutation = resolve; });
    const { runtime, useAuthStore, useCartStore } = setupCheckout({
      updateQuantity: () => pendingMutation, remove: () => pendingMutation,
    });
    let tree = await runtime.flush({});
    const button = operation === 'quantity'
      ? findElements(tree, (element) => element.type === 'button' && element.props.children === '+')[0]
      : findElements(tree, (element) => element.type === 'button' && element.props.className?.includes('hover:text-red-500'))[0];
    const mutation = button.props.onClick();
    useAuthStore.getState().login(secondUser, 'second-session');
    await runtime.flush();

    finishMutation({});
    await mutation;
    tree = await runtime.flush();

    assert.equal(useCartStore.getState().items.length, 1, `${operation}: B cart must remain`);
    assert.equal(useCartStore.getState().items[0].quantity, 3, `${operation}: B quantity must remain`);
    assert.equal(findElements(tree, (element) => element.type === 'input' && element.props.type === 'checkbox')[1].props.checked, true);
    assert.equal(checkoutButton(tree).props.disabled, false);
  }
});

test('checkout refuses a different browser tab token before the local auth store catches up', async () => {
  const { runtime, localStorage, creates } = setupCheckout();
  const tree = await runtime.flush({});
  localStorage.setItem('token', 'second-session');
  await checkoutButton(tree).props.onClick();
  assert.deepEqual(creates, []);
  assert.deepEqual(runtime.redirects, []);
});
