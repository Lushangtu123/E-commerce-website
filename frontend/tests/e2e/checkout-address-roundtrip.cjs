const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Address navigation keeps the checkout scope; all fixtures belong to the runner's isolated SQL. */
module.exports = async function checkoutAddressRoundtrip({ browser, adminContext, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' }, context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'checkout-address-roundtrip');
    const username = `addressround${Date.now()}`, account = { username, email: `${username}@example.test`, password: 'BrowserAddressRound123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    assert.equal((await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: '往返测试', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '测试路', is_default: true,
    } })).status(), 201);
    const chosenAddressResponse = await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: '主动选择收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '第二测试路', is_default: false,
    } });
    assert.equal(chosenAddressResponse.status(), 201);
    const chosenAddressId = (await chosenAddressResponse.json()).address_id;
    const now = Date.now();
    const couponResponse = await adminContext.request.post(`${api}/admin/coupons`, { headers, data: {
      code: `ROUND${now}`, name: '地址往返优惠券', type: 3, discount_value: 2, total_quantity: 2,
      start_time: new Date(now - 60000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
    } });
    assert.equal(couponResponse.status(), 200);
    const couponId = (await couponResponse.json()).data.coupon_id;
    const claim = await context.request.post(`${api}/coupons/receive`, { headers, data: { coupon_id: couponId, claim_key: randomUUID() } });
    assert.equal(claim.status(), 200);
    const userCouponId = (await claim.json()).data.user_coupon_id;
    const products = [];
    for (const title of ['地址往返购买商品', '地址往返保留商品']) {
      const result = await adminContext.request.post(`${api}/admin/products`, { headers, data: { title, title_en: title === '地址往返购买商品' ? 'Checkout address product' : 'Retained cart product', price: 10, stock: 20, category_id: 1, status: 1 } });
      assert.equal(result.status(), 201); products.push({ id: (await result.json()).product_id, title });
    }
    for (const product of products) assert.equal((await context.request.post(`${api}/cart`, { headers, data: { product_id: product.id, quantity: 1, add_key: randomUUID() } })).status(), 200);
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email); await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.waitForURL(`${origin}/`);
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    const beforeCart = (await (await context.request.get(`${api}/cart`)).json()).items;
    const beforeAddresses = (await (await context.request.get(`${api}/addresses`)).json()).addresses;
    const writes = [], previews = [];
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && request.url() === `${api}/orders/preview`) previews.push(request.postDataJSON());
      else if (!['GET', 'OPTIONS'].includes(request.method()) && /^\/api\/(cart|orders|addresses)(\/|$)/.test(pathname)) writes.push(`${request.method()} ${pathname}`);
    });
    const roundtrip = async () => {
      await page.getByRole('link', { name: '管理收货地址', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/profile/address');
      await page.getByRole('link', { name: '返回购物车', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/cart');
    };
    await page.goto(`${origin}/cart`); await page.getByRole('button', { name: '结算 (2)', exact: true }).click({ trial: true });
    await page.getByRole('checkbox', { name: `选择 ${products[1].title}`, exact: true }).uncheck();
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    await page.getByLabel('收货地址', { exact: true }).selectOption(String(chosenAddressId));
    await page.getByRole('combobox', { name: '优惠券', exact: true }).selectOption(String(userCouponId));
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    assert.equal(await page.getByText('应付金额', { exact: true }).locator('..').textContent(), '应付金额¥8.00');
    const count = previews.length;
    await roundtrip(); await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    assert.equal(await page.getByRole('checkbox', { name: `选择 ${products[1].title}`, exact: true }).isChecked(), false);
    assert.deepEqual(previews.at(-1).items, [{ product_id: products[0].id, quantity: 1 }]); assert.ok(previews.length > count);
    assert.equal(await page.getByLabel('收货地址', { exact: true }).inputValue(), String(chosenAddressId));
    assert.equal(await page.getByRole('combobox', { name: '优惠券', exact: true }).inputValue(), String(userCouponId));
    assert.equal(previews.at(-1).user_coupon_id, userCouponId);
    assert.equal(await page.getByText('应付金额', { exact: true }).locator('..').textContent(), '应付金额¥8.00');
    console.log('PASS browser address-management roundtrip retains deliberate checkout subset and obtains a fresh SQL quote without order writes');

    console.log('PASS browser chosen receiver and coupon survive real address management with fresh SQL amount');

    await page.getByRole('checkbox', { name: `选择 ${products[0].title}`, exact: true }).uncheck();
    await page.getByRole('button', { name: '结算 (0)', exact: true }).waitFor({ state: 'visible' });
    await roundtrip();
    assert.equal(await page.getByRole('button', { name: '结算 (0)', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: `选择 ${products[0].title}`, exact: true }).isChecked(), false);
    console.log('PASS browser address-management roundtrip preserves an explicit empty checkout');

    await page.goto(`${origin}/products/${products[0].id}`);
    const quote = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview`);
    await page.getByRole('button', { name: '立即购买', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/cart' && !!url.searchParams.get('buy_now')); assert.equal((await quote).status(), 200);
    const purchaseId = new URL(page.url()).searchParams.get('buy_now');
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    await page.getByLabel('收货地址', { exact: true }).selectOption(String(chosenAddressId));
    await page.getByRole('combobox', { name: '优惠券', exact: true }).selectOption(String(userCouponId));
    await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    const directCount = previews.length;
    await roundtrip(); await page.getByRole('button', { name: '结算 (1)', exact: true }).click({ trial: true });
    assert.equal(new URL(page.url()).searchParams.get('buy_now'), purchaseId);
    await page.getByRole('heading', { name: '确认本次购买', exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(previews.at(-1).items, [{ product_id: products[0].id, quantity: 1 }]); assert.ok(previews.length > directCount);
    assert.equal(await page.getByText(products[1].title, { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('收货地址', { exact: true }).inputValue(), String(chosenAddressId));
    assert.equal(await page.getByRole('combobox', { name: '优惠券', exact: true }).inputValue(), String(userCouponId));
    assert.equal(previews.at(-1).user_coupon_id, userCouponId);
    console.log('PASS browser direct purchase restores its own receiver and coupon after address management');
    assert.deepEqual(writes, []);
    assert.deepEqual((await (await context.request.get(`${api}/cart`)).json()).items, beforeCart);
    assert.deepEqual((await (await context.request.get(`${api}/addresses`)).json()).addresses, beforeAddresses);
    assert.equal((await (await context.request.get(`${api}/orders`)).json()).total, 0);
    console.log('PASS browser direct-buy address return preserves UUID, original item and fresh quote; SQL cart and addresses unchanged with zero order writes');
  } finally { await context.close(); }
};
