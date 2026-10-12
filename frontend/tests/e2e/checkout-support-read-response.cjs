const assert = require('node:assert/strict');

/** Exercise supporting checkout/catalog reads in the real production app and isolated SQL. */
module.exports = async function checkoutSupportReadResponse({ browser, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const context = await browser.newContext(), page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'checkout-support-read-response');
  try {
    await localPlatformScripts(context);
    const categoriesEndpoint = `${api}/products/categories`;
    let categoryReads = 0;
    const countCategories = request => { if (request.method() === 'GET' && request.url() === categoriesEndpoint) categoryReads++; };
    page.on('request', countCategories);
    const invalidCategories = route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    await page.route(categoriesEndpoint, invalidCategories);
    await page.goto(`${origin}/products?category_id=9000`);
    const region = page.getByRole('status').filter({ hasText: '分类暂时无法加载' });
    await region.waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('商品分类', { exact: true }).inputValue(), '9000');
    assert.ok(await page.locator('main h3').count() > 0, 'category failure preserves real SQL product rows');
    assert.equal(new URL(page.url()).searchParams.get('category_id'), '9000');
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    const englishRegion = page.getByRole('status').filter({ hasText: 'Categories are temporarily unavailable' });
    await englishRegion.waitFor({ state: 'visible' });
    assert.equal(categoryReads, 1);
    await page.unroute(categoriesEndpoint, invalidCategories);
    const categoryResponse = page.waitForResponse(response => response.request().method() === 'GET' && response.url() === categoriesEndpoint);
    await englishRegion.getByRole('button', { name: 'Try again', exact: true }).click();
    const restoredCategories = await categoryResponse; assert.equal(restoredCategories.status(), 200);
    assert.ok((await restoredCategories.json()).some(row => row.category_id === 9000 && row.name === 'PaginationFixture'));
    await englishRegion.waitFor({ state: 'detached' });
    await page.getByRole('option', { name: 'PaginationFixture', exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.getByLabel('Product category', { exact: true }).inputValue(), '9000');
    assert.equal(categoryReads, 2); page.off('request', countCategories);
    console.log('PASS browser invalid categories preserve SQL products and URL selection; bilingual one-GET retry restores real category options');

    const username = `supportread${Date.now()}`, account = { username, email: `${username}@example.test`, password: 'BrowserSupportRead123!' };
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const addressInput = { receiver_name: 'Support read receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: 'SUPPORT read street', is_default: true };
    assert.equal((await context.request.post(`${api}/addresses`, { headers, data: addressInput })).status(), 201);
    assert.equal((await context.request.post(`${api}/cart`, { headers, data: { product_id: 9001, quantity: 1 } })).status(), 200);
    await page.goto(`${origin}/login`);
    await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
    await page.getByLabel('邮箱', { exact: true }).fill(account.email); await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`); await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    const addresses = (await (await context.request.get(`${api}/addresses`)).json()).addresses;
    const beforeCart = (await (await context.request.get(`${api}/cart`)).json()).items;
    assert.ok(addresses.length === 1 && addresses[0].address_id > 0);
    const writes = [], endpoint = `${api}/addresses`;
    let addressReads = 0;
    const record = request => {
      if (!request.url().startsWith(api + '/')) return;
      if (request.method() === 'GET' && request.url() === endpoint) addressReads++;
      // Quote calculation is an explicitly read-only POST, not an order/cart/address mutation.
      if (!['GET', 'OPTIONS'].includes(request.method()) && request.url() !== `${api}/orders/preview`) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    };
    page.on('request', record);
    for (const [label, body] of [['missing collection', {}], ['invalid address identity', { addresses: [{ ...addresses[0], address_id: 0 }] }]]) {
      addressReads = 0;
      const invalidAddress = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      setExpectedRead({ endpoint }); await page.route(endpoint, invalidAddress);
      await page.goto(`${origin}/cart`);
      await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
      const alert = page.locator('main').getByRole('alert').filter({ hasText: '加载收货地址失败' });
      await alert.waitFor({ state: 'visible' });
      assert.equal(await page.getByText('请先添加收货地址', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('combobox', { name: '收货地址', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^结算 \(/ }).isDisabled(), true);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      const englishAlert = page.locator('main').getByRole('alert').filter({ hasText: 'Could not load your shipping addresses' });
      await englishAlert.waitFor({ state: 'visible' }); assert.equal(addressReads, 1); assert.deepEqual(writes, []);
      await page.unroute(endpoint, invalidAddress);
      const addressResponse = page.waitForResponse(response => response.request().method() === 'GET' && response.url() === endpoint);
      await englishAlert.getByRole('button', { name: 'Reload addresses', exact: true }).click();
      const restored = await addressResponse; assert.equal(restored.status(), 200); assert.deepEqual((await restored.json()).addresses, addresses);
      await englishAlert.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('combobox', { name: 'Shipping address', exact: true }).inputValue(), String(addresses[0].address_id));
      await page.getByRole('button', { name: /^Checkout \(/ }).click({ trial: true });
      assert.equal(addressReads, 2); assert.deepEqual(writes, []);
      console.log(`PASS browser checkout ${label} locks checkout and uses bilingual one-GET address retry without business writes`);
    }
    assert.deepEqual((await (await context.request.get(`${api}/cart`)).json()).items, beforeCart);
    assert.equal((await (await context.request.get(`${api}/orders`)).json()).total, 0);
    assert.deepEqual((await (await context.request.get(endpoint)).json()).addresses, addresses);
  } finally { setExpectedRead(undefined); await context.close(); }
};
