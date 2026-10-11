const assert = require('node:assert/strict');

/** Real cookie-backed sign-ins; all business requests use the isolated local SQL fixture. */
module.exports = async function customerLoginReturn({ browser, adminContext, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' }, contexts = [];
  const createCustomer = async label => {
    const context = await browser.newContext(); contexts.push(context);
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, label);
    const commerceWrites = [];
    page.on('request', request => {
      if (request.method() === 'OPTIONS' || request.method() === 'GET') return;
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/cart' || pathname.startsWith('/api/cart/') || pathname === '/api/orders' ||
          pathname === '/api/favorites' || pathname.startsWith('/api/favorites/')) {
        commerceWrites.push(`${request.method()} ${pathname}`);
      }
    });
    return { context, page, commerceWrites };
  };
  const assertNoPurchase = async ({ context, commerceWrites }) => {
    const cart = await context.request.get(`${api}/cart`); assert.equal(cart.status(), 200);
    assert.deepEqual((await cart.json()).items, []);
    const orders = await context.request.get(`${api}/orders`); assert.equal(orders.status(), 200);
    assert.equal((await orders.json()).total, 0);
    assert.deepEqual(commerceWrites, [], 'returning from authentication never automatically repeats the guest purchase action');
  };
  const signIn = async (page, account, destination) => {
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(destination);
    await page.getByText(account.username, { exact: true }).waitFor({ state: 'visible' });
  };
  const waitForAuth = (page, route, next) => page.waitForURL(url => url.pathname === route && url.searchParams.get('next') === next);
  try {
    const bootstrap = await browser.newContext(); contexts.push(bootstrap);
    const username = `return${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserLoginReturn123!' };
    assert.equal((await bootstrap.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const product = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title: '登录返回测试商品', title_en: 'Login return product', price: 12.5, stock: 20, category_id: 1, status: 1,
    } });
    assert.equal(product.status(), 201); const productId = (await product.json()).product_id;

    const guest = await createCustomer('login-return');
    const returnPath = `/products/${productId}?source=login-return-browser&view=details`;
    await guest.page.goto(`${origin}${returnPath}`);
    await guest.page.getByRole('button', { name: '加入购物车', exact: true }).click();
    await waitForAuth(guest.page, '/login', returnPath);
    const registerLink = guest.page.getByRole('link', { name: '立即注册', exact: true });
    assert.equal(await registerLink.getAttribute('href'), `/register?next=${encodeURIComponent(returnPath)}`);
    await registerLink.click(); await waitForAuth(guest.page, '/register', returnPath);
    const loginLink = guest.page.getByRole('link', { name: '立即登录', exact: true });
    assert.equal(await loginLink.getAttribute('href'), `/login?next=${encodeURIComponent(returnPath)}`);
    await loginLink.click(); await waitForAuth(guest.page, '/login', returnPath);
    await signIn(guest.page, account, `${origin}${returnPath}`);
    await guest.page.getByRole('button', { name: '加入购物车', exact: true }).click({ trial: true });
    await assertNoPurchase(guest);
    console.log('PASS browser guest add-to-cart and login/register switches preserve the full product next path and query');
    console.log('PASS browser login returns to actionable product controls without automatically adding items or creating an order');

    for (const replace of [false, true]) {
      const historyCustomer = await createCustomer(replace ? 'login-replace-state' : 'login-push-state');
      const historyPage = historyCustomer.page;
      const initialPath = `/products/${productId}?source=history-initial`;
      await historyPage.goto(`${origin}/login?next=${encodeURIComponent(initialPath)}`);
      const assertRegisterHref = async (path, checkEmail = true) => {
        const href = path === '/' ? '/register' : `/register?next=${encodeURIComponent(path)}`;
        await historyPage.waitForFunction(expected => Array.from(document.querySelectorAll('a'))
          .some(link => link.textContent.trim() === '立即注册' && link.getAttribute('href') === expected), href);
        assert.equal(await historyPage.getByRole('link', { name: '立即注册', exact: true }).getAttribute('href'), href);
        if (checkEmail) assert.equal(await historyPage.getByLabel('邮箱', { exact: true }).inputValue(), account.email, 'query changes retain the same login form');
      };
      // SSR uses /register; the next-bearing link proves the client snapshot is active
      // before interacting with the language selector or the browser History API.
      await assertRegisterHref(initialPath, false);
      await historyPage.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      await historyPage.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor({ state: 'visible' });
      await historyPage.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      await historyPage.getByRole('heading', { name: '登录账号', exact: true }).waitFor({ state: 'visible' });
      await historyPage.getByLabel('邮箱', { exact: true }).fill(account.email);
      await assertRegisterHref(initialPath);
      let destination = `/products/${productId}?source=history-push&view=latest`;
      await historyPage.evaluate(next => window.history.pushState({}, '', `/login?next=${encodeURIComponent(next)}`), destination);
      await waitForAuth(historyPage, '/login', destination); await assertRegisterHref(destination);
      if (replace) {
        await historyPage.evaluate(() => window.history.replaceState({}, '', '/login?next=%2F'));
        await waitForAuth(historyPage, '/login', '/'); await assertRegisterHref('/');
        destination = `/products/${productId}?source=history-replace&view=final`;
        await historyPage.evaluate(next => window.history.replaceState({}, '', `/login?next=${encodeURIComponent(next)}`), destination);
        await waitForAuth(historyPage, '/login', destination); await assertRegisterHref(destination);
      }
      await signIn(historyPage, account, `${origin}${destination}`);
      await historyPage.getByRole('button', { name: '加入购物车', exact: true }).click({ trial: true });
      await assertNoPurchase(historyCustomer);
      console.log(`PASS browser real Next ${replace ? 'pushState and replaceState' : 'pushState'} update the same-route auth link and successful login uses the latest next without a purchase write`);
    }

    const registration = await createCustomer('register-return');
    const registrationPath = `/products/${productId}?source=register-return-browser`;
    await registration.page.goto(`${origin}${registrationPath}`);
    await registration.page.getByRole('button', { name: '收藏', exact: true }).click();
    await waitForAuth(registration.page, '/login', registrationPath);
    await registration.page.getByRole('link', { name: '立即注册', exact: true }).click();
    await waitForAuth(registration.page, '/register', registrationPath);
    const registeredName = `registeredreturn${Date.now()}`;
    await registration.page.getByLabel('用户名', { exact: true }).fill(registeredName);
    await registration.page.getByLabel('邮箱', { exact: true }).fill(`${registeredName}@example.test`);
    await registration.page.getByLabel('密码', { exact: true }).fill('BrowserRegisteredReturn123!');
    await registration.page.getByLabel('确认密码', { exact: true }).fill('BrowserRegisteredReturn123!');
    await registration.page.getByRole('button', { name: '注册', exact: true }).click();
    await registration.page.waitForURL(`${origin}${registrationPath}`);
    await registration.page.getByText(registeredName, { exact: true }).waitFor({ state: 'visible' });
    await registration.page.getByRole('button', { name: '加入购物车', exact: true }).click({ trial: true });
    await registration.page.getByRole('button', { name: '收藏', exact: true }).click({ trial: true });
    const favorite = await registration.context.request.get(`${api}/favorites/check/${productId}`);
    assert.equal(favorite.status(), 200); assert.equal((await favorite.json()).is_favorited, false);
    await assertNoPurchase(registration);
    console.log('PASS browser guest favorite can register and return with the original query without replaying favorite or purchase writes');

    const unsafe = await createCustomer('login-unsafe-return');
    await unsafe.page.goto(`${origin}/login?next=${encodeURIComponent('https://example.test/outside')}`);
    assert.equal(await unsafe.page.getByRole('link', { name: '立即注册', exact: true }).getAttribute('href'), '/register');
    await signIn(unsafe.page, account, `${origin}/`);
    assert.equal(new URL(unsafe.page.url()).origin, origin);
    await assertNoPurchase(unsafe);
    console.log('PASS browser external login next is discarded by the auth-switch link and sign-in safely returns to the homepage');
  } finally { for (const context of contexts.reverse()) await context.close(); }
};
