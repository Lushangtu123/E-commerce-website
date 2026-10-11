const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Cookie-backed customer purchases against the runner's throwaway MySQL database. */
module.exports = async function buyNow({ browser, adminContext, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const contexts = [];
  const customerContext = async label => {
    const context = await browser.newContext(); contexts.push(context);
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, label);
    return { context, page };
  };
  const signIn = async (page, account, target) => {
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(target);
    await page.getByText(account.username, { exact: true }).waitFor({ state: 'visible' });
  };
  const normalizedCart = items => items.map(item => ({ product_id: item.product_id, sku_id: item.sku_id ?? null, quantity: item.quantity }))
    .sort((a, b) => a.product_id - b.product_id || (a.sku_id ?? 0) - (b.sku_id ?? 0));
  try {
    const { context, page } = await customerContext('buy-now');
    const username = `buynow${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserBuyNow123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const address = await context.request.post(`${api}/addresses`, { headers, data: {
      receiver_name: '本次购买测试', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区',
      detail_address: '测试路2号', is_default: true,
    } });
    assert.equal(address.status(), 201);

    const products = [];
    for (const [title, title_en, price] of [
      ['本次普通购买商品', 'Buy-now ordinary product', 17.5],
      ['本次规格购买商品', 'Buy-now variant product', 99],
      ['保留的其他购物车商品', 'Preserved other cart product', 5],
    ]) {
      const response = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
        title, title_en, price, stock: products.length === 0 ? 3 : 20, category_id: 1, status: 1,
      } });
      assert.equal(response.status(), 201);
      products.push({ id: (await response.json()).product_id, title, title_en, price });
    }
    const [ordinary, variant, other] = products;
    const skus = [];
    for (const [name, price] of [['红色', 17.25], ['蓝色', 18.5]]) {
      const response = await adminContext.request.post(`${api}/admin/products/${variant.id}/skus`, { headers, data: {
        sku_code: `BUY-NOW-${variant.id}-${skus.length}`, specs: { 颜色: name }, price, stock: skus.length === 0 ? 3 : 20, status: 1,
      } });
      assert.equal(response.status(), 201); skus.push((await response.json()).sku_id);
    }
    const retained = [
      { product_id: ordinary.id, quantity: 3 }, { product_id: other.id, quantity: 2 },
      { product_id: variant.id, sku_id: skus[0], quantity: 3 }, { product_id: variant.id, sku_id: skus[1], quantity: 2 },
    ];
    for (const item of retained) {
      assert.equal((await context.request.post(`${api}/cart`, { headers, data: { ...item, add_key: randomUUID() } })).status(), 200);
    }
    const getCart = async () => {
      const response = await context.request.get(`${api}/cart`); assert.equal(response.status(), 200);
      return (await response.json()).items;
    };
    const getOrders = async () => {
      const response = await context.request.get(`${api}/orders`); assert.equal(response.status(), 200);
      return response.json();
    };
    assert.deepEqual(normalizedCart(await getCart()), normalizedCart(retained));
    assert.equal((await getOrders()).total, 0);
    await page.goto(`${origin}/login`); await signIn(page, account, `${origin}/`);

    const cartWrites = [], orderWrites = [], previews = [], orderIds = [];
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (request.url() === `${api}/cart`) cartWrites.push(request.postDataJSON());
      if (request.url() === `${api}/orders`) orderWrites.push(request.postDataJSON());
      if (request.url() === `${api}/orders/preview`) previews.push(request.postDataJSON());
    });
    const cases = [
      { product: ordinary, item: { product_id: ordinary.id, quantity: 1 }, price: 17.5 },
      { product: variant, item: { product_id: variant.id, sku_id: skus[0], quantity: 1 }, price: 17.25 },
    ];
    for (const [index, purchase] of cases.entries()) {
      await page.goto(`${origin}/products/${purchase.product.id}`);
      await page.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
      if (purchase.item.sku_id) {
        await page.waitForFunction(() => !document.querySelector('#product-sku')?.disabled);
        await page.getByLabel('商品规格', { exact: true }).selectOption(String(purchase.item.sku_id));
      }
      await page.locator('#product-quantity').fill('1');
      const quoteResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview`);
      await page.getByRole('button', { name: '立即购买', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/cart' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url.searchParams.get('buy_now') || ''));
      const purchaseUrl = page.url(), purchaseId = new URL(purchaseUrl).searchParams.get('buy_now');
      const quote = await quoteResponse; assert.equal(quote.status(), 200);
      assert.deepEqual(quote.request().postDataJSON(), { items: [purchase.item] });
      assert.equal((await quote.json()).original_amount, purchase.price);
      await page.getByRole('heading', { name: '确认本次购买', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('heading', { name: purchase.product.title, exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('checkbox').count(), 1);
      assert.equal(await page.getByRole('checkbox').isDisabled(), true);
      assert.equal(await page.getByRole('heading', { name: other.title, exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '删除', exact: true }).isDisabled(), true);
      assert.deepEqual(normalizedCart(await getCart()), normalizedCart(retained), 'direct purchase never increments old cart quantities');
      assert.equal(cartWrites.length, 0); assert.equal(orderWrites.length, index);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      await page.getByRole('heading', { name: 'Confirm this purchase', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('heading', { name: purchase.product.title_en, exact: true }).waitFor({ state: 'visible' });
      const refreshQuote = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview`);
      await page.reload(); const restoredQuote = await refreshQuote;
      assert.equal(restoredQuote.status(), 200); assert.deepEqual(restoredQuote.request().postDataJSON(), { items: [purchase.item] });
      assert.equal((await restoredQuote.json()).total_amount, purchase.price);
      await page.getByRole('button', { name: 'Checkout (1)', exact: true }).click({ trial: true });
      assert.equal(page.url(), purchaseUrl); assert.equal(cartWrites.length, 0); assert.equal(orderWrites.length, index);
      assert.equal((await getOrders()).total, index, 'confirmation reload never creates an order');
      console.log(`PASS browser ${purchase.item.sku_id ? 'SKU' : 'ordinary'} Buy now quotes only one newly selected unit and bilingual refresh retains the scoped purchase`);

      const orderResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders`);
      await page.getByRole('button', { name: 'Checkout (1)', exact: true }).click();
      const submitted = await orderResponse; assert.equal(submitted.status(), 201);
      const orderId = (await submitted.json()).order_id; orderIds.push(orderId);
      await page.waitForURL(`${origin}/orders/${orderId}`);
      assert.equal(orderWrites.length, index + 1);
      assert.deepEqual(orderWrites[index].items, [purchase.item]); assert.equal(orderWrites[index].checkout_source, 'buy_now'); assert.equal(orderWrites[index].checkout_key, purchaseId);
      const detailResponse = await context.request.get(`${api}/orders/${orderId}`); assert.equal(detailResponse.status(), 200);
      const detail = await detailResponse.json();
      assert.deepEqual(normalizedCart(detail.items), normalizedCart([purchase.item]));
      assert.equal(Number(detail.order.total_amount), purchase.price);
      assert.deepEqual(normalizedCart(await getCart()), normalizedCart(retained), 'old three units, the other SKU and the other product all survive checkout');
      await page.waitForFunction(() => document.querySelector('header a[href="/cart"]')?.textContent?.trim() === '10');
      await page.goto(purchaseUrl);
      await page.getByRole('alert').getByText('This purchase is no longer available. Return to the product page and choose again.', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('button', { name: 'Checkout (1)', exact: true }).count(), 0);
      assert.equal(orderWrites.length, index + 1); assert.equal(cartWrites.length, 0);
      assert.equal((await getOrders()).total, index + 1);
      assert.deepEqual(normalizedCart(await getCart()), normalizedCart(retained));
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser ${purchase.item.sku_id ? 'SKU' : 'ordinary'} Buy now creates one exact SQL order, preserves old cart quantities and cannot reorder a completed intent`);
    }
    assert.equal(new Set(orderIds).size, 2);
    assert.ok(previews.every(preview => preview.items.length === 1 && preview.items[0].quantity === 1));
    for (const [product, expected] of [[ordinary, 2], [other, 20]]) {
      const response = await context.request.get(`${api}/products/${product.id}`); assert.equal(response.status(), 200);
      assert.equal((await response.json()).product.stock, expected);
    }
    const variantResponse = await context.request.get(`${api}/products/${variant.id}`); assert.equal(variantResponse.status(), 200);
    const currentSkus = (await variantResponse.json()).product.skus;
    assert.equal(currentSkus.find(sku => sku.sku_id === skus[0]).stock, 2);
    assert.equal(currentSkus.find(sku => sku.sku_id === skus[1]).stock, 20);
    console.log('PASS browser Buy now deducts only one ordinary unit and one selected SKU unit from real SQL inventory');

  } finally { for (const context of contexts.reverse()) await context.close(); }
};
