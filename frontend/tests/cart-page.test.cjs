const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage } = require('./runtime.cjs');

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const cartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'First customer product', price: 10, stock: 5 };

function setupCart(list) {
  const stores = loadStores();
  stores.useAuthStore.getState().login(firstUser, 'first-session');
  const runtime = loadPage('src/app/cart/page.tsx', {
    globals: stores,
    imports: {
      '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
      '@/store/useCartStore': { cartItemKey: stores.cartItemKey, useCartStore: () => stores.useCartStore.getState() },
      '@/lib/api': { addressApi: { list: async () => ({ addresses: [] }) }, cartApi: { list } },
    },
  });
  return { ...stores, runtime };
}

test('failed cart loading clears cached items and the header count for the current customer', async () => {
  const { useCartStore, runtime } = setupCart(async () => { throw new Error('Unavailable'); });
  useCartStore.getState().setItems([cartItem]);

  await runtime.render({});

  assert.equal(useCartStore.getState().items.length, 0);
  assert.equal(useCartStore.getState().getTotalCount(), 0);
});

test('switching customers reloads cart even when authentication stays true', async () => {
  let requests = 0;
  const { useAuthStore, useCartStore, runtime } = setupCart(async () => {
    requests += 1;
    return { items: [{ ...cartItem, product_id: requests === 1 ? 12 : 22 }] };
  });
  await runtime.render({});

  useAuthStore.getState().login(secondUser, 'second-session');
  await runtime.render({});

  assert.equal(requests, 2);
  assert.equal(useCartStore.getState().items[0].product_id, 22);
});

test('late success or failure from a previous customer cannot overwrite or clear the new cart', async () => {
  for (const outcome of ['success', 'failure']) {
    let finishFirstRequest;
    let failFirstRequest;
    let requests = 0;
    const firstRequest = new Promise((resolve, reject) => {
      finishFirstRequest = resolve;
      failFirstRequest = reject;
    });
    const { useAuthStore, useCartStore, runtime } = setupCart(() => {
      requests += 1;
      return requests === 1 ? firstRequest : Promise.resolve({ items: [{ ...cartItem, product_id: 22 }] });
    });
    await runtime.render({});
    useAuthStore.getState().logout();
    useAuthStore.getState().login(secondUser, 'second-session');
    await runtime.render({});
    assert.equal(useCartStore.getState().items[0].product_id, 22);

    if (outcome === 'success') finishFirstRequest({ items: [cartItem] });
    else failFirstRequest(new Error('Previous session failed'));
    await new Promise(setImmediate);

    assert.equal(useCartStore.getState().items[0]?.product_id, 22, `${outcome}: the new customer cart must survive`);
    assert.equal(useCartStore.getState().getTotalCount(), 3);
  }
});
