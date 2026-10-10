const assert = require('node:assert/strict');

/** Real cookies and SQL-backed saved products; keyboard and middle clicks exercise native Next Links. */
module.exports = async function customerProductLinks({ browser, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `links${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserProductLinks123!' };
    const registered = await context.request.post(`${api}/users/register`, { headers, data: account });
    assert.equal(registered.status(), 201);
    assert.equal((await context.request.post(`${api}/favorites`, { headers, data: { product_id: 1 } })).status(), 200);
    assert.equal((await context.request.post(`${api}/browse/record`, { headers, data: { product_id: 1 } })).status(), 200);
    const productResponse = await context.request.get(`${api}/products/1`);
    assert.equal(productResponse.status(), 200);
    const product = (await productResponse.json()).product;

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'customer-product-links');
    const forbiddenWrites = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' && request.method() !== 'OPTIONS' &&
          (/^\/api\/cart(?:\/|$)/.test(url.pathname) || /^\/api\/favorites(?:\/|$)/.test(url.pathname) ||
          request.method() === 'DELETE' && /^\/api\/browse\/history(?:\/|$)/.test(url.pathname))) {
        forbiddenWrites.push(`${request.method()} ${url.pathname}`);
      }
    });
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);

    for (const kind of ['favorites', 'history']) {
      const locale = kind === 'favorites' ? 'zh-CN' : 'en';
      await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption(locale);
      const title = locale === 'en' ? product.title_en || product.title : product.title;
      const collectionUrl = `${origin}/${kind}`;
      const openCollection = async () => {
        await page.goto(collectionUrl);
        await page.getByRole('heading', { level: 2, name: title, exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.locator('a[href="/products/1"]').count(), 2, 'image and heading expose independent detail links');
      };
      // Both controls remain real anchors with their own tab stop, rather than scripted key handlers.
      for (const index of [0, 1]) {
        await openCollection();
        const link = page.locator('a[href="/products/1"]').nth(index);
        assert.equal(await link.evaluate(node => node.tabIndex), 0);
        assert.equal(await link.locator('button').count(), 0, 'cart and removal controls are outside each link');
        await link.focus(); await page.keyboard.press('Enter');
        await page.waitForURL(`${origin}/products/1`);
        await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor({ state: 'visible' });
      }
      console.log(`PASS browser ${kind} image and title anchors open product detail with keyboard Enter (${locale})`);

      await openCollection();
      const [opened] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('a[href="/products/1"]').first().click({ button: 'middle' }),
      ]);
      opened.setDefaultTimeout(30000);
      opened.on('pageerror', error => errors.push(error.message)); watchConsole(opened, `customer-product-links-${kind}-tab`);
      await opened.waitForURL(`${origin}/products/1`);
      await opened.getByRole('heading', { level: 1, name: title, exact: true }).waitFor({ state: 'visible' });
      assert.equal(page.url(), collectionUrl, 'opening a background tab retains the collection page');
      await opened.close();
      console.log(`PASS browser ${kind} middle click opens a native product tab and keeps the collection page`);
    }
    assert.deepEqual(forbiddenWrites, [], 'link activation never adds to cart or removes saved products');
    const favorites = await context.request.get(`${api}/favorites/my`);
    assert.equal(favorites.status(), 200);
    assert.equal((await favorites.json()).favorites.filter(row => row.product_id === 1).length, 1);
    const history = await context.request.get(`${api}/browse/history`);
    assert.equal(history.status(), 200);
    assert.equal((await history.json()).history.filter(row => row.product_id === 1).length, 1);
    const cart = await context.request.get(`${api}/cart`);
    assert.equal(cart.status(), 200);
    assert.deepEqual((await cart.json()).items, []);
  } finally { await context.close(); }
};
