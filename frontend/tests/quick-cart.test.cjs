const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource, loadStores } = require('./runtime.cjs');

function setup(detail, add = async () => ({})) {
  const stores = loadStores();
  stores.useAuthStore.getState().login({ user_id: 1, username: 'one' }, 'one');
  const requests = [];
  const { quickAddToCart } = loadSource('src/lib/quick-cart.ts', stores, {
    '@/store/useAuthStore': { useAuthStore: stores.useAuthStore },
    '@/store/useCartStore': { useCartStore: stores.useCartStore },
    '@/lib/api': { productApi: { getDetail: detail }, cartApi: { add: async item => { requests.push(item); return add(item); } } },
  });
  return { ...stores, requests, quickAddToCart };
}

test('quick add sends SKU products to explicit selection and keeps ordinary products directly purchasable', async () => {
  for (const has_sku of [true, false]) {
    const context = setup(async () => ({ product: { product_id: 1, title: 'Shirt', has_sku, price: '15.00', stock: 3 } }));
    assert.equal(await context.quickAddToCart(1), has_sku ? 'select' : 'added');
    assert.equal(context.requests.length, has_sku ? 0 : 1);
    assert.equal(context.useCartStore.getState().items.length, has_sku ? 0 : 1);
    if (!has_sku) assert.equal(context.useCartStore.getState().items[0].price, 15);
  }
});

test('quick add rejects sold out base products and failures without success or local cart changes', async () => {
  const empty = setup(async () => ({ product: { product_id: 1, has_sku: false, stock: 0 } }));
  await assert.rejects(empty.quickAddToCart(1));
  assert.equal(empty.requests.length, 0);
  const failed = setup(async () => ({ product: { product_id: 1, stock: 3, price: 10 } }), async () => { throw new Error('Stock changed'); });
  await assert.rejects(failed.quickAddToCart(1));
  assert.equal(failed.useCartStore.getState().items.length, 0);
});

test('late detail and add responses cannot act on a replacement customer or browser token', async () => {
  for (const phase of ['detail', 'add']) {
    for (const change of ['account', 'storage']) {
      let finish;
      const pending = new Promise(resolve => { finish = resolve; });
      const product = { product_id: 1, stock: 3, price: 10, has_sku: false };
      const context = setup(phase === 'detail' ? () => pending : async () => ({ product }), phase === 'add' ? () => pending : undefined);
      const work = context.quickAddToCart(1);
      await new Promise(setImmediate);
      if (change === 'account') context.useAuthStore.getState().login({ user_id: 2, username: 'two' }, 'two');
      else context.localStorage.setItem('token', 'two');
      finish(phase === 'detail' ? { product } : {});
      assert.equal(await work, null);
      assert.equal(context.useCartStore.getState().items.length, 0);
      assert.equal(context.requests.length, phase === 'detail' ? 0 : 1);
    }
  }
});

test('leaving the quick-add view suppresses late selection and cart mutations', async () => {
  for (const phase of ['detail', 'add']) {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    let active = true;
    const product = { product_id: 1, stock: 3, price: 10, has_sku: phase === 'detail' };
    const context = setup(phase === 'detail' ? () => pending : async () => ({ product }), phase === 'add' ? () => pending : undefined);
    const work = context.quickAddToCart(1, () => active);
    await new Promise(setImmediate);
    active = false;
    finish(phase === 'detail' ? { product } : {});
    assert.equal(await work, null);
    assert.equal(context.useCartStore.getState().items.length, 0);
  }
});
