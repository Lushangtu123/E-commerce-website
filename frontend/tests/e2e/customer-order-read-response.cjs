const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Invalid successful reads cannot publish order rows or unlock their actions. */
module.exports = async function customerOrderReadResponse({ browser, adminContext, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `orderread${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserOrderRead123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const address = await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: 'Order read receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: 'Order read street', is_default: true,
    } });
    assert.equal(address.status(), 201);
    const product = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title: '订单读取验证商品', title_en: 'Order read validation product', price: 12, stock: 5, category_id: 1, status: 1,
    } });
    assert.equal(product.status(), 201);
    const productId = (await product.json()).product_id;
    const created = await context.request.post(`${api}/orders`, { headers, data: {
      items: [{ product_id: productId, quantity: 1 }], shipping_address_id: (await address.json()).address_id, checkout_key: randomUUID(),
    } });
    assert.equal(created.status(), 201);
    const id = (await created.json()).order_id;
    const detailEndpoint = `${api}/orders/${id}`;
    const detailResponse = await context.request.get(detailEndpoint); assert.equal(detailResponse.status(), 200);
    const actual = await detailResponse.json(); assert.equal(actual.order.status, 0); assert.equal(actual.items.length, 1);
    const listResponse = await context.request.get(`${api}/orders?page=1&limit=10`); assert.equal(listResponse.status(), 200);
    const list = await listResponse.json(); assert.equal(list.total, 1); assert.equal(list.orders[0].order_id, id);

    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'customer-order-read-response');
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`); await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    const writes = [], reads = new Map();
    page.on('request', request => {
      if (request.url().startsWith(api + '/') && !['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      if (request.method() === 'GET') {
        const endpoint = request.url().split('?')[0];
        reads.set(endpoint, (reads.get(endpoint) || 0) + 1);
      }
    });
    for (const target of [
      { endpoint: `${api}/orders`, path: '/orders', invalid: { ...list, orders: [{ ...list.orders[0], shipping_company: {} }] }, chinese: '加载订单失败，请重试', english: 'Could not load your orders. Please try again' },
      { endpoint: detailEndpoint, path: `/orders/${id}`, invalid: { ...actual, items: [{ ...actual.items[0], price: '1e2' }] }, chinese: '加载订单详情失败，请重试', english: 'Could not load order details. Please try again' },
    ]) {
      const previousReads = reads.get(target.endpoint) || 0;
      const matches = url => url.origin + url.pathname === target.endpoint;
      const invalidRead = route => route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target.invalid) })
        : route.continue();
      setExpectedRead({ endpoint: target.endpoint, prefix: '加载订单失败:' });
      await context.route(matches, invalidRead); await page.goto(origin + target.path);
      const alert = page.locator('main').getByRole('alert');
      await alert.getByText(target.chinese, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('button', { name: '取消订单', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '模拟支付', exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: '暂无订单', exact: true }).count(), 0);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      await alert.getByText(target.english, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(reads.get(target.endpoint), previousReads + 1, 'language changes do not retry invalid data');
      assert.deepEqual(writes, []);
      await context.unroute(matches, invalidRead);
      const retryResponse = page.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === target.endpoint);
      await alert.getByRole('button', { name: /^(Retry|Reload)$/ }).click();
      const restored = await retryResponse; assert.equal(restored.status(), 200);
      const restoredData = await restored.json();
      if (target.path === '/orders') assert.deepEqual(restoredData, list);
      else assert.deepEqual(restoredData, actual);
      await alert.waitFor({ state: 'detached' });
      await page.getByText(actual.order.order_no, { exact: target.path !== '/orders' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Cancel order', exact: true }).click({ trial: true });
      assert.equal(reads.get(target.endpoint), previousReads + 2, 'explicit retry makes one fresh order read');
      assert.deepEqual(writes, [], 'explicit read retries never pay, cancel or confirm an order');
      assert.equal((await (await context.request.get(detailEndpoint)).json()).order.status, 0);
      setExpectedRead(undefined);
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser invalid customer ${target.path} success shows bilingual retry without actions; real SQL retry restores the pending order without writes`);
    }
  } finally { setExpectedRead(undefined); await context.close(); }
};
