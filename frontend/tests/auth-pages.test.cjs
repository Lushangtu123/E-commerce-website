const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./runtime.cjs');

const pages = [
  'cart', 'coupons', 'favorites', 'history', 'orders', 'orders/[id]', 'profile', 'my/coupons',
];

test('protected pages wait for hydration before redirecting and load the persisted session afterwards', async () => {
  for (const page of pages) {
    const runtime = loadPage(`src/app/${page}/page.tsx`);

    await runtime.render({ isHydrated: false, isAuthenticated: false, user: null });

    assert.deepEqual(runtime.redirects, [], `${page}: must wait before redirecting`);
    assert.deepEqual(runtime.requests, [], `${page}: must wait before requesting protected data`);

    await runtime.render({ isHydrated: true, isAuthenticated: true, user: { user_id: 1 } });

    assert.deepEqual(runtime.redirects, [], `${page}: persisted session must stay on the page`);
    assert.equal(runtime.requests.length, 1, `${page}: must load once hydration finishes`);
  }
});

test('protected pages redirect an anonymous session only after hydration finishes', async () => {
  for (const page of pages) {
    const runtime = loadPage(`src/app/${page}/page.tsx`);

    await runtime.render({ isHydrated: false, isAuthenticated: false, user: null });
    await runtime.render({ isHydrated: true, isAuthenticated: false, user: null });

    assert.deepEqual(runtime.redirects, ['/login'], `${page}: must redirect once hydration confirms no session`);
    assert.deepEqual(runtime.requests, [], `${page}: anonymous sessions must not request protected data`);
  }
});
