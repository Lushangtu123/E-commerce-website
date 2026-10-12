const assert = require('node:assert/strict');

/** Exercise all shared quick-add callers and auxiliary detail reads over the real local SQL fixture. */
module.exports = async function productReadBoundaries({ browser, adminContext, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'product-read-boundaries');
    const username = `region${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserRegionContract123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const created = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title: '商品区域验证', title_en: 'Product region validation', price: 11, stock: 5, category_id: 1, status: 1,
    } });
    assert.equal(created.status(), 201);
    const id = (await created.json()).product_id, endpoint = `${api}/products/${id}`;
    const actual = await context.request.get(endpoint); assert.equal(actual.status(), 200);
    const canonical = await actual.json();
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`); await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    assert.equal((await context.request.post(`${api}/favorites`, { headers, data: { product_id: id } })).status(), 200);
    assert.equal((await context.request.post(`${api}/browse/record`, { headers, data: { product_id: id } })).status(), 200);
    let cartWrites = 0, orderWrites = 0, browseWrites = 0;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (request.url() === `${api}/cart`) cartWrites++;
      if (request.url() === `${api}/orders`) orderWrites++;
      if (request.url() === `${api}/browse/record`) browseWrites++;
    });
    let quantity = 0;
    for (const [label, path, invalid] of [
      ['catalog', '/products?keyword=' + encodeURIComponent('商品区域验证'), { ...canonical.product, product_id: id + 1 }],
      ['favorites', '/favorites', { ...canonical.product, stock: undefined }],
      ['history', '/history', { ...canonical.product, price: '1e2' }],
    ]) {
      let broken = true, reads = 0;
      const routeRead = route => { reads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ product: broken ? invalid : canonical.product }) }); };
      setExpectedRead({ endpoint, prefix: '加入购物车失败:' });
      await page.route(endpoint, routeRead); await page.goto(origin + path);
      const heading = page.getByRole('heading', { name: '商品区域验证', exact: true });
      await heading.waitFor({ state: 'visible' });
      const add = heading.locator('..').getByRole('button', { name: label === 'catalog' ? '加入' : '加入购物车', exact: true });
      await add.click({ trial: true });
      const previousWrites = cartWrites;
      await add.click(); await page.getByText('加载商品失败，请重试', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(reads, 1); assert.equal(cartWrites, previousWrites);
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('pending-cart-add:'))), false);
      const unchanged = await context.request.get(`${api}/cart`); assert.equal(unchanged.status(), 200);
      const before = (await unchanged.json()).items;
      assert.equal(before.reduce((sum, row) => sum + row.quantity, 0), quantity);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      const translatedAdd = page.getByRole('heading', { name: 'Product region validation', exact: true }).locator('..').getByRole('button', { name: label === 'catalog' ? 'Add' : 'Add to cart', exact: true });
      await translatedAdd.click();
      await page.getByText('Unable to load this product. Please try again.', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(reads, 2); assert.equal(cartWrites, previousWrites);
      broken = false;
      await Promise.all([
        page.waitForResponse(response => response.url() === `${api}/cart` && response.request().method() === 'POST' && response.status() === 200),
        translatedAdd.click(),
      ]);
      await page.waitForFunction(() => !Object.keys(sessionStorage).some(key => key.startsWith('pending-cart-add:')));
      await page.getByText('Added to cart', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(reads, 3); assert.equal(cartWrites, previousWrites + 1); assert.equal(orderWrites, 0);
      const cart = await context.request.get(`${api}/cart`); assert.equal(cart.status(), 200);
      assert.equal((await cart.json()).items.find(row => row.product_id === id).quantity, ++quantity);
      await page.unroute(endpoint, routeRead); setExpectedRead(undefined);
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser ${label} invalid quick-add read sends no cart write or retry identity; explicit valid read adds one real SQL cart unit`);
    }

    for (const [label, path, invalid, chinese, english, prefix] of [
      ['reviews', `/reviews/product/${id}`, { reviews: [{ review_id: 1, product_id: id, rating: 5, content: {} }], total: 1, totalPages: 1 }, '用户评价', 'Customer reviews', '加载评论失败:'],
      ['recommendations', `/recommendations/related/${id}`, { related_products: {} }, '相关推荐', 'Related products', '加载相关推荐失败:'],
    ]) {
      const url = api + path;
      const actual = await context.request.get(url + (label === 'reviews' ? '?page=1&limit=5' : '?limit=4'));
      assert.equal(actual.status(), 200); const valid = await actual.json();
      if (label === 'recommendations') assert.ok(valid.related_products.length > 0);
      let broken = true, reads = 0;
      const matches = candidate => candidate.origin === new URL(api).origin && candidate.pathname === new URL(url).pathname;
      const routeRead = route => { reads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(broken ? invalid : valid) }); };
      setExpectedRead({ endpoint: url, prefix }); await page.route(matches, routeRead);
      await page.goto(`${origin}/products/${id}`);
      await page.getByRole('heading', { name: '商品区域验证', exact: true }).waitFor({ state: 'visible' });
      const region = page.getByRole('heading', { name: chinese, exact: true }).locator('..');
      await region.getByRole('alert').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '立即购买', exact: true }).click({ trial: true });
      const previousReads = reads, previousBrowse = browseWrites, previousWrites = cartWrites;
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      const translated = page.getByRole('heading', { name: english, exact: true }).locator('..');
      await translated.getByRole('alert').getByText(label === 'reviews' ? 'Unable to load reviews. Please try again.' : 'Unable to load recommendations. Please try again.', { exact: true }).waitFor({ state: 'visible' });
      broken = false; await translated.getByRole('button', { name: 'Retry', exact: true }).click();
      await translated.getByRole('alert').waitFor({ state: 'detached' });
      if (label === 'reviews') await translated.getByText('No reviews yet', { exact: true }).waitFor({ state: 'visible' });
      else await translated.getByRole('heading', { name: valid.related_products[0].title_en?.trim() || valid.related_products[0].title, exact: true }).waitFor({ state: 'visible' });
      assert.equal(reads, previousReads + 1); assert.equal(browseWrites, previousBrowse); assert.equal(cartWrites, previousWrites); assert.equal(orderWrites, 0);
      const stock = await context.request.get(endpoint); assert.equal((await stock.json()).product.stock, 5);
      await page.unroute(matches, routeRead); setExpectedRead(undefined);
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser invalid ${label} preserves the SQL-backed product and buying controls; bilingual regional retry restores real data without extra writes`);
    }
  } finally { setExpectedRead(undefined); await context.close(); }
};
