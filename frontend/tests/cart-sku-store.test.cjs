const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores } = require('./runtime.cjs');

test('cart identities keep base and each SKU separate when adding, updating and removing', () => {
  const { useCartStore } = loadStores();
  const store = useCartStore.getState();
  const base = { cart_id: 1, product_id: 12, quantity: 1, title: 'Shirt', price: 10, stock: 9 };
  store.addItem(base);
  store.addItem({ ...base, cart_id: 2, sku_id: 101, quantity: 2, price: 20 });
  store.addItem({ ...base, cart_id: 3, sku_id: 102, quantity: 3, price: 30 });
  store.addItem({ ...base, sku_id: 101, quantity: 1, price: 20 });
  assert.deepEqual(Array.from(useCartStore.getState().items, item => [item.sku_id ?? null, item.quantity]), [[null, 1], [101, 3], [102, 3]]);
  store.updateQuantity(12, 4, 101);
  assert.deepEqual(Array.from(useCartStore.getState().items, item => item.quantity), [1, 4, 3]);
  store.removeItem(12, 101);
  assert.deepEqual(Array.from(useCartStore.getState().items, item => item.sku_id ?? null), [null, 102]);
  store.updateQuantity(12, 2);
  store.removeItem(12);
  assert.deepEqual(Array.from(useCartStore.getState().items, item => [item.sku_id, item.quantity]), [[102, 3]]);
  assert.equal(store.getTotalCount(), 3);
  assert.equal(store.getTotalPrice(), 90);
});
