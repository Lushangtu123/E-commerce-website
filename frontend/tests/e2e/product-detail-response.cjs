const assert = require('node:assert/strict');

/** Bad client GET replies must not unlock purchases over a correct SQL-backed SSR page. */
module.exports = async function productDetailResponse({ browser, adminContext, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'product-detail-response');
    const username = `detail${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserDetailContract123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const created = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title: '商品读取验证', title_en: 'Product read validation', price: 10, stock: 3, category_id: 1, status: 1,
    } });
    assert.equal(created.status(), 201);
    const id = (await created.json()).product_id;
    const endpoint = `${api}/products/${id}`;
    const response = await context.request.get(endpoint); assert.equal(response.status(), 200);
    const canonical = await response.json();
    const html = await context.request.get(`${origin}/products/${id}`); assert.equal(html.status(), 200);
    assert.match(await html.text(), /商品读取验证/);
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    const writes = [];
    let browseWrites = 0;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (request.url() === `${api}/cart` || request.url() === `${api}/orders`) writes.push(request.url());
      if (request.url() === `${api}/browse/record`) browseWrites++;
    });
    for (const [label, invalid] of [
      ['missing product', {}], ['null product', { product: null }],
      ['wrong identity', { product: { ...canonical.product, product_id: id + 1, title: '错误商品', title_en: 'Wrong product', price: 99 } }],
    ]) {
      let broken = true, reads = 0;
      const read = route => {
        reads++;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(broken ? invalid : canonical) });
      };
      setExpectedRead({ endpoint, prefix: '加载商品失败:' });
      await page.route(endpoint, read);
      await page.goto(`${origin}/products/${id}`);
      await page.getByRole('alert').getByText('加载商品失败，请重试', { exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('heading', { name: '商品读取验证', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('button', { name: '加入购物车', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '立即购买', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('heading', { name: '错误商品', exact: true }).count(), 0);
      const beforeRetryReads = reads;
      assert.ok(beforeRetryReads >= 1); assert.deepEqual(writes, []);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      await page.getByRole('alert').getByText('Unable to load this product. Please try again.', { exact: true }).waitFor({ state: 'visible' });
      const previousBrowseWrites = browseWrites;
      broken = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click({ trial: true });
      assert.equal(reads, beforeRetryReads + 1); assert.equal(browseWrites, previousBrowseWrites);
      assert.deepEqual(writes, []);
      const cart = await context.request.get(`${api}/cart`); assert.equal(cart.status(), 200);
      assert.deepEqual((await cart.json()).items, []);
      const stock = await context.request.get(endpoint); assert.equal(stock.status(), 200);
      assert.equal((await stock.json()).product.stock, 3);
      await page.unroute(endpoint, read); setExpectedRead(undefined);
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser ${label} detail preserves SQL-backed SSR, locks purchases and recovers with a bilingual read-only retry`);
    }
  } finally {
    setExpectedRead(undefined);
    await context.close();
  }
};
