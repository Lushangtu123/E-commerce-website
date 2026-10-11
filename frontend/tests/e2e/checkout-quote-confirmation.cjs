const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** A real administrator changes the SQL price after the customer sees a quote. */
module.exports = async function checkoutQuoteConfirmation({ browser, adminContext, localPlatformScripts, watchConsole, errors, setExpectedQuoteChange }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'quote-confirmation');
    const username = `quote${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserQuoteConfirm123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    assert.equal((await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: '改价确认测试', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区',
      detail_address: '测试路3号', is_default: true,
    } })).status(), 201);
    const created = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title: '改价确认商品', title_en: 'Price confirmation product', price: 10, stock: 5, category_id: 1, status: 1,
    } });
    assert.equal(created.status(), 201);
    const productId = (await created.json()).product_id;
    assert.equal((await context.request.post(`${api}/cart`, { headers, data: {
      product_id: productId, quantity: 2, add_key: randomUUID(),
    } })).status(), 200);
    const orders = async () => {
      const response = await context.request.get(`${api}/orders`); assert.equal(response.status(), 200);
      return response.json();
    };
    const cart = async () => {
      const response = await context.request.get(`${api}/cart`); assert.equal(response.status(), 200);
      return (await response.json()).items.map(item => ({ product_id: item.product_id, quantity: item.quantity }));
    };
    const stock = async () => {
      const response = await context.request.get(`${api}/products/${productId}`); assert.equal(response.status(), 200);
      return (await response.json()).product.stock;
    };
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    await page.goto(`${origin}/products/${productId}`);
    await page.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
    const writes = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url() === `${api}/orders`) writes.push(request.postDataJSON());
    });
    const initialQuoteResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview`);
    await page.getByRole('button', { name: '立即购买', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/cart' && !!url.searchParams.get('buy_now'));
    const initialQuote = await initialQuoteResponse; assert.equal(initialQuote.status(), 200);
    assert.equal((await initialQuote.json()).total_amount, 10);
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    const purchaseId = new URL(page.url()).searchParams.get('buy_now');
    assert.equal((await adminContext.request.put(`${api}/admin/products/${productId}`, { headers, data: { price: 20 } })).status(), 200);

    setExpectedQuoteChange(true);
    const rejectedResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders`);
    const updatedQuoteResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview`);
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click();
    const rejected = await rejectedResponse; assert.equal(rejected.status(), 409);
    assert.equal((await rejected.json()).code, 'CHECKOUT_QUOTE_CHANGED');
    const updatedQuote = await updatedQuoteResponse; assert.equal(updatedQuote.status(), 200);
    assert.equal((await updatedQuote.json()).total_amount, 20);
    await page.getByRole('alert').getByText('结算金额已变化，请核对新报价后再次点击结算', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    setExpectedQuoteChange(false);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].expected_quote, { original_amount: 10, discount_amount: 0, total_amount: 10 });
    assert.equal(writes[0].checkout_key, purchaseId); assert.equal(writes[0].checkout_source, 'buy_now');
    assert.equal((await orders()).total, 0);
    assert.equal(await stock(), 5);
    assert.deepEqual(await cart(), [{ product_id: productId, quantity: 2 }]);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('alert').getByText('Checkout amounts changed. Check the new quote and click Checkout again.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(writes.length, 1);
    console.log('PASS browser an actual SQL price change returns 409, refreshes the bilingual quote and leaves orders, stock and old cart untouched until a new click');

    const acceptedResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders`);
    await page.getByRole('button', { name: 'Checkout (1)', exact: true }).click();
    const accepted = await acceptedResponse; assert.equal(accepted.status(), 201);
    const orderId = (await accepted.json()).order_id;
    await page.waitForURL(`${origin}/orders/${orderId}`);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].expected_quote, { original_amount: 20, discount_amount: 0, total_amount: 20 });
    assert.equal(writes[1].checkout_key, purchaseId);
    assert.equal((await orders()).total, 1);
    assert.equal(await stock(), 4);
    assert.deepEqual(await cart(), [{ product_id: productId, quantity: 2 }]);
    const detail = await context.request.get(`${api}/orders/${orderId}`); assert.equal(detail.status(), 200);
    assert.equal(Number((await detail.json()).order.total_amount), 20);
    console.log('PASS browser an explicit second click confirms the new SQL price, creates one order and deducts only the purchased unit');
  } finally {
    setExpectedQuoteChange(false);
    await context.close();
  }
};
