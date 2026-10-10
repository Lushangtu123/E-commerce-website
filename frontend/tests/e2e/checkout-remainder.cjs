const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Two actual tabs share customer cookies but hold different cart snapshots. */
module.exports = async function checkoutRemainder({ browser, adminContext, localPlatformScripts, watchConsole, errors, setExpectedWrite }) {
  const api = 'http://127.0.0.1:3101/api', home = 'http://127.0.0.1:3100/';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const account = { username: `remainder${Date.now()}`, email: `remainder${Date.now()}@example.test`, password: 'BrowserRemainder123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    assert.equal((await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: '数量保留测试', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '测试路1号', is_default: true,
    } })).status(), 201);
    const first = await context.newPage(), second = await context.newPage();
    for (const page of [first, second]) {
      page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'checkout-remainder');
    }
    await first.goto(`${home}login`);
    await first.getByLabel('邮箱', { exact: true }).fill(account.email);
    await first.getByLabel('密码', { exact: true }).fill(account.password);
    await first.getByRole('button', { name: '登录', exact: true }).click(); await first.waitForURL(home);

    for (const lostReply of [false, true]) {
      const title = lostReply ? '重试结算数量保留商品' : '正常结算数量保留商品';
      const product = await adminContext.request.post(`${api}/admin/products`, { headers, data: { title, price: 10, stock: 10, category_id: 1, status: 1 } });
      assert.equal(product.status(), 201); const productId = (await product.json()).product_id;
      assert.equal((await context.request.post(`${api}/cart`, { headers, data: { product_id: productId, quantity: 1, add_key: randomUUID() } })).status(), 200);
      await first.goto(`${home}cart`);
      await first.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
      const selected = first.getByRole('checkbox', { name: `选择 ${title}`, exact: true });
      assert.equal(await selected.isChecked(), true);
      // The second tab adds two units while the first continues to show one.
      await second.goto(`${home}products/${productId}`);
      await second.locator('#product-quantity').fill('2');
      const addResponse = second.waitForResponse(response => response.url() === `${api}/cart` && response.request().method() === 'POST');
      await second.getByRole('button', { name: '加入购物车', exact: true }).click(); assert.equal((await addResponse).status(), 200);
      const before = (await (await context.request.get(`${api}/cart`)).json()).items.find(item => item.product_id === productId);
      assert.equal(before.quantity, 3);
      const inputs = []; let orderId;
      const endpoint = `${api}/orders`;
      const intercept = async route => {
        if (route.request().method() !== 'POST') return route.continue();
        inputs.push(route.request().postDataJSON());
        const response = await route.fetch(); assert.equal(response.status(), 201);
        const returnedOrderId = (await response.json()).order_id;
        if (orderId !== undefined) assert.equal(returnedOrderId, orderId, 'receipt replay returns the original order');
        orderId = returnedOrderId;
        if (lostReply && inputs.length === 1) return route.abort('failed');
        return route.fulfill({ response });
      };
      await first.route(endpoint, intercept);
      if (lostReply) setExpectedWrite({ endpoint });
      // Unselect a previous scenario's preserved rows; they must also survive.
      for (const box of await first.getByRole('checkbox').all()) {
        const name = await box.getAttribute('aria-label');
        if (name?.startsWith('选择 ') && name !== `选择 ${title}` && await box.isChecked()) await box.uncheck();
      }
      await first.getByRole('button', { name: /^结算 \(1\)$/ }).click();
      if (lostReply) {
        await first.getByRole('button', { name: '重试确认订单', exact: true }).click();
        assert.deepEqual(inputs[1], inputs[0]);
      }
      await first.waitForURL(/\/orders\/\d+$/);
      const rows = (await (await context.request.get(`${api}/cart`)).json()).items;
      assert.equal(rows.find(item => item.product_id === productId).quantity, 2);
      const expectedCount = rows.reduce((sum, row) => sum + row.quantity, 0);
      await first.waitForFunction(count => document.querySelector('header a[href="/cart"]')?.textContent?.trim() === String(count), expectedCount);
      const order = (await (await context.request.get(`${endpoint}/${orderId}`)).json()).items;
      assert.equal(order.length, 1); assert.equal(order[0].product_id, productId); assert.equal(order[0].quantity, 1);
      assert.equal((await (await context.request.get(`${api}/products/${productId}`)).json()).product.stock, 9);
      assert.equal(inputs.length, lostReply ? 2 : 1);
      await first.unroute(endpoint, intercept); setExpectedWrite(undefined);
      console.log(`PASS browser ${lostReply ? 'lost-reply replay' : 'normal checkout'} retains two-tab added quantities, canonical badge and one stock deduction`);
    }
  } finally { setExpectedWrite(undefined); await context.close(); }
};
