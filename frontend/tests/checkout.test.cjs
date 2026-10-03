const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const firstItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'Product', price: 10, stock: 5 };
const shippingAddress = { address_id: 41, receiver_name: 'First Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一西路 1 号', is_default: true };
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
  updateQuantity = async () => ({}), remove = async () => ({}), addresses = async () => ({ addresses: [shippingAddress] }) } = {}) {
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
      '@/store/useCartStore': { cartItemKey: stores.cartItemKey, useCartStore: () => stores.useCartStore.getState() },
      'react-hot-toast': { __esModule: true, default: toast, toast },
      '@/lib/api': {
        addressApi: { list: addresses },
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
  const selector = findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0];
  assert.equal(selector.props.value, '');
  assert.deepEqual(findElements(selector, (element) => element.type === 'option').map((element) => element.props.value), ['', 7]);
  assert.equal(textContent(amountRow(tree, '商品总价')), '商品总价¥90.00');
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥0.00');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥90.00');
});

test('two SKUs of one product stay independently selected, quoted, updated, removed and purchased', async () => {
  const variants = [
    { ...firstItem, sku_id: 101, sku_code: 'RED', sku_specs: { Color: 'Red' }, quantity: 1 },
    { ...firstItem, cart_id: 2, sku_id: 102, sku_code: 'BLUE', sku_specs: { Color: 'Blue' }, quantity: 2 },
  ];
  const updates = [];
  const removals = [];
  const { runtime, previews, creates, useCartStore } = setupCheckout({
    cartItems: variants, updateQuantity: async (input) => { updates.push(input); },
    remove: async (...args) => { removals.push(args); },
  });
  let tree = await runtime.flush({});
  assert.deepEqual(previews.at(-1).items, [{ product_id: 12, quantity: 1, sku_id: 101 }, { product_id: 12, quantity: 2, sku_id: 102 }]);
  assert.ok(textContent(tree).includes('Color: Red'));
  assert.ok(textContent(tree).includes('Color: Blue'));
  await findElements(tree, element => element.type === 'button' && element.props.children === '+')[0].props.onClick();
  tree = await runtime.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ product_id: 12, quantity: 2, sku_id: 101 }]);
  assert.deepEqual(Array.from(useCartStore.getState().items, item => item.quantity), [2, 2]);
  findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox')[2].props.onChange();
  tree = await runtime.flush();
  assert.deepEqual(previews.at(-1).items, [{ product_id: 12, quantity: 2, sku_id: 101 }]);
  await checkoutButton(tree).props.onClick();
  assert.deepEqual(creates.at(-1).items, [{ product_id: 12, quantity: 2, sku_id: 101 }]);
  assert.deepEqual(Array.from(useCartStore.getState().items, item => item.sku_id), [102]);
  tree = await runtime.flush();
  await findElements(tree, element => element.type === 'button' && element.props.className?.includes('hover:text-red-500'))[0].props.onClick();
  assert.deepEqual(removals, [[12, 102]]);
  assert.equal(useCartStore.getState().items.length, 0);
});

test('unavailable rows cannot be selected or quoted and explain how to reselect a SKU', async () => {
  const { runtime, previews } = setupCheckout({ cartItems: [
    { ...firstItem, available: false, unavailable_reason: '请选择商品规格' },
    { ...firstItem, cart_id: 2, sku_id: 102, available: 0, unavailable_reason: '规格已停用' },
    { ...firstItem, cart_id: 3, product_id: 22, available: true },
  ] });
  let tree = await runtime.flush({});
  assert.deepEqual(previews.at(-1).items, [{ product_id: 22, quantity: 3 }]);
  const checkboxes = findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox');
  assert.equal(checkboxes[1].props.disabled, true);
  assert.equal(checkboxes[2].props.disabled, true);
  assert.ok(textContent(tree).includes('请选择商品规格'));
  assert.ok(textContent(tree).includes('重新选规格'));
  checkboxes[0].props.onChange();
  tree = await runtime.flush();
  assert.equal(checkoutButton(tree).props.disabled, true);
  checkboxes[0].props.onChange();
  tree = await runtime.flush();
  assert.deepEqual(previews.at(-1).items, [{ product_id: 22, quantity: 3 }]);
});

test('selecting a coupon requotes the order and submits only its ID with selected product quantities', async () => {
  const { runtime, previews, creates } = setupCheckout({ preview: async (input) => quote(90, input.user_coupon_id === 7) });
  let tree = await runtime.flush({});
  findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.onChange({ target: { value: '7' } });

  tree = await runtime.flush();
  assert.equal(previews.at(-1).user_coupon_id, 7);
  assert.equal(textContent(amountRow(tree, '优惠券优惠')), '优惠券优惠-¥20.00');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥70.00');
  await findElements(tree, (element) => element.type === 'button' && textContent(element).includes('结算 ('))[0].props.onClick();

  assert.deepEqual(creates, [{ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7, shipping_address_id: 41 }]);
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

  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, 7);
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥70.00');
  assert.deepEqual(previews.map((input) => input.user_coupon_id), [undefined, 7]);
  findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.onChange({ target: { value: '' } });
  tree = await runtime.flush();

  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, '');
  assert.equal(textContent(amountRow(tree, '应付金额')), '应付金额¥90.00');
});

test('unavailable carried coupons are reported and never sent to preview or checkout', async () => {
  const { runtime, previews, notifications } = setupCheckout({ search: '?user_coupon_id=999' });

  const tree = await runtime.flush({});

  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, '');
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
  findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.onChange({ target: { value: '7' } });

  tree = await runtime.flush();

  assert.ok(notifications.includes('优惠券已过期'));
  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, '');
  assert.equal(findElements(findElements(tree, element => element.type === 'select' && element.props.id === 'checkout-coupon')[0], element => element.type === 'option').length, 1);
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

  assert.deepEqual(creates, [{ items: [{ product_id: 12, quantity: 3 }], shipping_address_id: 41 }]);
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
  findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.onChange({ target: { value: '7' } });
  tree = await runtime.flush();
  checkoutButton(tree).props.onClick();

  useAuthStore.getState().login(secondUser, 'second-session');
  tree = await runtime.flush();

  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, '');
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
  findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.onChange({ target: { value: '7' } });
  tree = await runtime.flush();

  await checkoutButton(tree).props.onClick();
  tree = await runtime.flush();

  assert.ok(notifications.includes('优惠券已被使用'));
  assert.equal(useCartStore.getState().items.length, 1);
  assert.deepEqual(runtime.redirects, []);
  assert.equal(findElements(tree, (element) => element.type === 'select' && element.props.id === 'checkout-coupon')[0].props.value, '');
  assert.equal(previews.at(-1).user_coupon_id, undefined);
  assert.equal(findElements(findElements(tree, element => element.type === 'select' && element.props.id === 'checkout-coupon')[0], element => element.type === 'option').length, 1);
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

test('a cart line with reduced stock can lower quantity to recover and be selected again', async () => {
  const cartItems = [{ ...firstItem, sku_id: 101, quantity: 3, stock: 2, available: false, unavailable_reason: '库存不足' }];
  const updates = [];
  const context = setupCheckout({ cartItems, updateQuantity: async input => {
    updates.push(input);
    cartItems[0] = { ...cartItems[0], quantity: input.quantity, available: true, unavailable_reason: null };
  } });
  let tree = await context.runtime.flush({});
  const decrease = findElements(tree, element => element.type === 'button' && textContent(element) === '-')[0];
  assert.equal(decrease.props.disabled, false);
  await decrease.props.onClick();
  tree = await context.runtime.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ product_id: 12, sku_id: 101, quantity: 2 }]);
  assert.equal(context.useCartStore.getState().items[0].available, true);
  const boxes = findElements(tree, element => element.type === 'input' && element.props.type === 'checkbox');
  assert.ok(boxes.every(box => box.props.disabled === false));
});


test('checkout requires a loaded owned address while quote calculation remains independent', async () => {
  for (const outcome of ['empty', 'loading', 'failure']) {
    const context = setupCheckout({ addresses: () => outcome === 'loading' ? new Promise(() => {}) : outcome === 'empty' ? Promise.resolve({ addresses: [] }) : Promise.reject(new Error('Unavailable')) });
    const tree = await context.runtime.flush({});
    assert.equal(checkoutButton(tree).props.disabled, true, outcome);
    await checkoutButton(tree).props.onClick();
    assert.deepEqual(context.creates, [], outcome);
    assert.equal(context.previews.length, 1, 'quotes do not need a shipping address');
    assert.ok(findElements(tree, element => element.props.href === '/profile/address').length > 0);
  }
});

test('checkout selects the default address and submits an explicitly chosen address ID', async () => {
  const other = { ...shippingAddress, address_id: 42, receiver_name: 'Other Receiver', is_default: false };
  const { runtime, creates, previews } = setupCheckout({ addresses: async () => ({ addresses: [other, shippingAddress] }) });
  let tree = await runtime.flush({});
  const select = findElements(tree, element => element.type === 'select' && element.props.id === 'shipping-address')[0];
  assert.ok(select);
  assert.equal(select.props.value, 41);
  select.props.onChange({ target: { value: '42' } });
  tree = await runtime.flush();
  await checkoutButton(tree).props.onClick();
  assert.equal(creates[0].shipping_address_id, 42);
  assert.ok(previews.every(input => !Object.hasOwn(input, 'shipping_address_id')));
});

test('a failed address load retries and makes checkout available only after addresses arrive', async () => {
  let calls = 0;
  const context = setupCheckout({ addresses: async () => { if (++calls === 1) throw new Error('Unavailable'); return { addresses: [shippingAddress] }; } });
  let tree = await context.runtime.flush({}); assert.equal(checkoutButton(tree).props.disabled, true);
  await findElements(tree, element => element.type === 'button' && textContent(element) === '重新加载地址')[0].props.onClick();
  tree = await context.runtime.flush(); assert.equal(checkoutButton(tree).props.disabled, false);
  await checkoutButton(tree).props.onClick(); assert.equal(context.creates[0].shipping_address_id, 41);
});

test('changing customers immediately hides old address options and rejects late address responses', async () => {
  for (const outcome of ['success', 'failure']) {
    let finish, fail; const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let calls = 0;
    const context = setupCheckout({ addresses: () => ++calls === 1 ? pending : Promise.resolve({ addresses: [{ ...shippingAddress, address_id: 42, receiver_name: 'Second Receiver' }] }) });
    await context.runtime.flush({}); context.useAuthStore.getState().login(secondUser, 'second-session');
    let tree = await context.runtime.render(); assert.ok(!textContent(tree).includes('First Receiver'));
    tree = await context.runtime.flush(); assert.ok(textContent(tree).includes('Second Receiver'));
    if (outcome === 'success') finish({ addresses: [shippingAddress] }); else fail(new Error('Old address error'));
    await new Promise(setImmediate); tree = await context.runtime.flush();
    assert.ok(textContent(tree).includes('Second Receiver')); assert.ok(!textContent(tree).includes('First Receiver'));
    await checkoutButton(tree).props.onClick(); assert.equal(context.creates[0].shipping_address_id, 42);
  }
});

test('address options already loaded for A disappear in the first render for B', async () => {
  let calls = 0;
  const context = setupCheckout({ addresses: () => ++calls === 1 ? Promise.resolve({ addresses: [shippingAddress] }) : new Promise(() => {}) });
  const firstTree = await context.runtime.flush({}); assert.ok(textContent(firstTree).includes('First Receiver'));
  context.useAuthStore.getState().login(secondUser, 'second-session');
  let tree = await context.runtime.render(); assert.ok(!textContent(tree).includes('First Receiver'));
  tree = await context.runtime.flush();
  assert.equal(checkoutButton(tree).props.disabled, true);
});

test('leaving checkout before create returns prevents late cart changes and navigation', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const context = setupCheckout({ create: () => pending }); const tree = await context.runtime.flush({});
  const work = checkoutButton(tree).props.onClick(); context.runtime.unmount(); finish({ order_id: 55 }); await work;
  assert.equal(context.useCartStore.getState().items.length, 1); assert.deepEqual(context.runtime.redirects, []);
});

test('a deleted shipping address rejected by create is reloaded and cannot be submitted again', async () => {
  let exists = true, loads = 0;
  const context = setupCheckout({ addresses: async () => { loads++; return { addresses: exists ? [shippingAddress] : [] }; },
    create: async () => { exists = false; throw { response: { data: { error: '收货地址不存在' } } }; } });
  let tree = await context.runtime.flush({}); await checkoutButton(tree).props.onClick(); tree = await context.runtime.flush();
  assert.equal(loads, 2); assert.ok(textContent(tree).includes('请先添加收货地址'));
  assert.equal(checkoutButton(tree).props.disabled, true); await checkoutButton(tree).props.onClick();
  assert.equal(context.creates.length, 1); assert.equal(context.useCartStore.getState().items.length, 1);
  assert.ok(context.notifications.includes('收货地址不存在'));
});
