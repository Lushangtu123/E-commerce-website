const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadSource } = require('./runtime.cjs');

function loadStore(storage) {
  const browser = createBrowser(storage);
  const cartModule = loadSource('src/store/useCartStore.ts');
  const { useAuthStore } = loadSource('src/store/useAuthStore.ts', browser, {
    '@/lib/logger': { logger: { error() {} } },
    '@/store/useCartStore': cartModule,
  });
  return { ...browser, useAuthStore, ...cartModule };
}

test('hydration restores persisted customer login before protected pages decide authentication', () => {
  const user = { user_id: 1, username: 'customer', email: 'customer@example.test' };
  const { useAuthStore } = loadStore({ token: 'customer-session', user: JSON.stringify(user) });

  assert.equal(useAuthStore.getState().isHydrated, false);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  useAuthStore.getState().hydrate();

  assert.equal(useAuthStore.getState().isHydrated, true);
  assert.equal(useAuthStore.getState().isAuthenticated, true);
  assert.equal(useAuthStore.getState().token, 'customer-session');
  assert.deepEqual(JSON.parse(JSON.stringify(useAuthStore.getState().user)), user);
});

test('absent or malformed customer storage finishes hydration without authenticating an admin session', () => {
  for (const user of [undefined, '{invalid-json']) {
    const { useAuthStore } = loadStore({
      token: 'customer-session', ...(user && { user }),
      admin_token: 'admin-session', admin_user: '{"admin_id":2}',
    });

    useAuthStore.getState().hydrate();

    assert.equal(useAuthStore.getState().isHydrated, true);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
    assert.equal(useAuthStore.getState().user, null);
    assert.equal(useAuthStore.getState().token, null);
  }
});

test('switching customer login and logging out clear cart contents and the header count', () => {
  const { useAuthStore, useCartStore, localStorage } = loadStore({ admin_token: 'admin-session' });
  const cartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'Product', price: 10, stock: 5 };
  useAuthStore.getState().login({ user_id: 1, username: 'first', email: 'first@example.test' }, 'first-session');
  useCartStore.getState().setItems([cartItem]);
  assert.equal(useCartStore.getState().getTotalCount(), 3);

  useAuthStore.getState().login({ user_id: 2, username: 'second', email: 'second@example.test' }, 'second-session');

  assert.equal(useCartStore.getState().items.length, 0);
  assert.equal(useCartStore.getState().getTotalCount(), 0);
  assert.equal(useCartStore.getState().getTotalPrice(), 0);
  useCartStore.getState().setItems([cartItem]);
  useAuthStore.getState().logout();
  assert.equal(useCartStore.getState().items.length, 0);
  assert.equal(useCartStore.getState().getTotalCount(), 0);
  assert.equal(localStorage.getItem('admin_token'), 'admin-session');
});
