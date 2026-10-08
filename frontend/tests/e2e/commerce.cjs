const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const backend = path.resolve(root, '../backend');
const children = [];
let browser;
let lastLogs = '';
function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.on('error', error => { child.startupError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { lastLogs = (lastLogs + chunk.toString()).slice(-5000); });
  return child;
}
async function ready(url, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null) throw new Error('Local test server exited before readiness');
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Local test server readiness timeout');
}
// Console errors are collected from every page. Only the deliberate old-password login and
// the injected checkout failures at their exact endpoint may log their expected errors.
const consoleErrors = [];
let expectedLoginFailure = false;
const expectedLoginErrors = [/status of 401 \(Unauthorized\)/, /^登录请求失败/];
let expectedCheckoutFailure = false;
const checkoutEndpoint = 'http://127.0.0.1:3101/api/orders';
const expectedCheckoutErrors = [/^Failed to load resource: net::ERR_FAILED$/, /^Failed to load resource: the server responded with a status of (408|429)(?: \([^)]*\))?$/];
let expectedOrderDetailFailure;
let expectedShoppingFailure;
function watchConsole(page, label) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expectedLoginFailure && expectedLoginErrors.some(pattern => pattern.test(text))) return;
    if (expectedCheckoutFailure && message.location().url === checkoutEndpoint && expectedCheckoutErrors.some(pattern => pattern.test(text))) return;
    if (expectedOrderDetailFailure &&
        (message.location().url === expectedOrderDetailFailure && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) || /^加载订单失败:/.test(text))) return;
    if (expectedShoppingFailure &&
        (message.location().url === expectedShoppingFailure && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) || /^加载(?:商品|购物车)失败:/.test(text))) return;
    consoleErrors.push(`[${label}] ${new URL(page.url()).pathname}: ${text.slice(0, 300)}`);
  });
}
async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
}
(async () => {
  const fixture = start(process.execPath, ['scripts/e2e-server.cjs'], backend, {});
  await ready('http://127.0.0.1:3101/api/products', fixture);
  const frontend = start(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3100', '-H', '127.0.0.1'], root, {
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3101/api', ECOMMERCE_SERVERLESS_API: 'false',
    NODE_ENV: 'development', VERCEL: '', VERCEL_ENV: '', NEXT_TELEMETRY_DISABLED: '1',
  });
  await ready('http://127.0.0.1:3100/register', frontend);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  watchConsole(page, 'customer');
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:3100/register');
  await page.locator('input[name="username"]').fill(`browser${Date.now()}`);
  const customerEmail = `browser${Date.now()}@example.test`;
  await page.locator('input[name="email"]').fill(customerEmail);
  await page.locator('input[name="password"]').fill('BrowserCustomer123!');
  await page.locator('input[name="confirmPassword"]').fill('BrowserCustomer123!');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  console.log('PASS browser registration');
  const searchForm = page.getByRole('search');
  const searchInput = searchForm.getByRole('textbox', { name: '搜索商品', exact: true });
  const searchKeyword = '浏览器交易测试商品';
  await searchInput.fill(searchKeyword);
  const recordedSearch = page.waitForResponse(response => response.url() === 'http://127.0.0.1:3101/api/search/record' && response.request().method() === 'POST');
  await searchForm.getByRole('button', { name: '搜索', exact: true }).click();
  assert.equal((await recordedSearch).status(), 200);
  await page.waitForURL(`http://127.0.0.1:3100/products?keyword=${encodeURIComponent(searchKeyword)}`);
  await searchInput.focus();
  const historyEntry = searchForm.getByText(searchKeyword, { exact: true });
  await historyEntry.waitFor({ state: 'visible' });
  await historyEntry.hover();
  const searchUrl = page.url();
  const unintendedSearches = [];
  const watchSearch = request => {
    if (request.url() === 'http://127.0.0.1:3101/api/search/record' && request.method() === 'POST') unintendedSearches.push(request.postDataJSON());
  };
  page.on('request', watchSearch);
  const deletedSearch = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().startsWith('http://127.0.0.1:3101/api/search/history/'));
  await historyEntry.locator('..').getByRole('button', { name: '删除', exact: true }).click();
  assert.equal((await deletedSearch).status(), 200);
  await historyEntry.waitFor({ state: 'hidden' });
  const history = await context.request.get('http://127.0.0.1:3101/api/search/history');
  assert.equal(history.status(), 200);
  assert.deepEqual(unintendedSearches, [], 'deleting history must not submit another search');
  assert.equal((await history.json()).history.some(entry => entry.keyword === searchKeyword), false, 'deleted keyword stays absent from real MySQL history');
  assert.equal(page.url(), searchUrl);
  assert.equal(await searchInput.inputValue(), searchKeyword);
  page.off('request', watchSearch);
  console.log('PASS browser history deletion preserves search input and URL without re-recording the keyword');
  await page.goto('http://127.0.0.1:3100/products');
  const skuCard = page.locator('a[href="/products/2"]').filter({ has: page.getByRole('heading', { name: '浏览器规格价格商品', exact: true }) }).first();
  await skuCard.getByText('¥99.00', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await skuCard.locator('.line-through').textContent(), '¥100.00');
  for (const endpoint of ['/products/hot', '/search/es?keyword=浏览器规格价格商品', '/recommendations/related/1']) {
    const response = await context.request.get(`http://127.0.0.1:3101/api${endpoint}`);
    assert.equal(response.status(), 200);
    const data = await response.json();
    const product = (data.products || data.data || data.related_products).find(p => p.product_id === 2);
    assert.ok(product, `SKU fixture is present in ${endpoint}`);
    assert.equal(Number(product.price), 99);
    assert.equal(Number(product.original_price), 100);
  }
  console.log('PASS browser catalog card, search, hot and related products share the cheapest SKU promotion price');
  const productEndpoint = 'http://127.0.0.1:3101/api/products/2';
  let productAttempts = 0;
  const failProductOnce = route => ++productAttempts === 1
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) })
    : route.continue();
  expectedShoppingFailure = productEndpoint;
  await page.route(productEndpoint, failProductOnce);
  await page.goto('http://127.0.0.1:3100/products/2');
  const variant = page.getByLabel('商品规格', { exact: true });
  await variant.waitFor({ state: 'visible' });
  await visibleText(page, '加载商品失败，请重试');
  assert.equal(await variant.isDisabled(), true, 'stale inventory stays locked after a 503');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await visibleText(page, 'Unable to load this product. Please try again.');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#product-sku')?.disabled);
  assert.equal(productAttempts, 2, 'one explicit retry reloads fresh inventory');
  await page.unroute(productEndpoint, failProductOnce);
  expectedShoppingFailure = undefined;
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser product 503 retains readable content and bilingual retry reloads inventory');
  const pricing = page.locator('span.text-3xl').locator('..');
  assert.equal(await pricing.locator('.line-through').count(), 0, 'no parent discount before selecting a variant');
  await variant.selectOption('201');
  await pricing.getByText('¥100.00', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await pricing.locator('.line-through').textContent(), '¥100.00');
  await pricing.getByText('¥99.00', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Browser variant product', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('Product options', { exact: true }).inputValue(), '201');
  assert.match(await page.getByLabel('Product options', { exact: true }).locator('option:checked').textContent(), /Color: Red/);
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  assert.equal(await variant.inputValue(), '201');
  console.log('PASS browser English variant labels preserve selected SKU identity');
  await variant.selectOption('202');
  await pricing.getByText('¥100.00', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await pricing.locator('.line-through').count(), 0, 'equal variant prices have no discount');
  await variant.selectOption('203');
  await pricing.getByText('¥150.00', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await pricing.locator('.line-through').count(), 0, 'null variant original price does not inherit parent');
  console.log('PASS browser selected SKU owns its promotion price without inheriting parent discounts');
  await page.goto('http://127.0.0.1:3100/profile/address');
  await page.getByRole('button', { name: '新增地址', exact: true }).click();
  for (const [field, value] of Object.entries({ receiver_name: '浏览器测试收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '仅测试地址1号' })) {
    await page.locator(`input[name="${field}"]`).fill(value);
  }
  await page.getByRole('button', { name: '保存地址', exact: true }).click();
  await visibleText(page, '仅测试地址1号');
  await page.goto('http://127.0.0.1:3100/products/1');
  // SSR exposes the language select before its change handler hydrates. Fresh inventory unlocks this button.
  await page.getByRole('button', { name: '加入购物车', exact: true }).click({ trial: true });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  await visibleText(page, 'Browser English description');
  await visibleText(page, 'Cotton');
  const englishSearch = await context.request.get('http://127.0.0.1:3101/api/products?keyword=Browser%20checkout');
  assert.equal(englishSearch.status(), 200);
  assert.equal((await englishSearch.json()).products.some(product => product.product_id === 1), true);
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await visibleText(page, '浏览器中文描述');
  console.log('PASS browser bilingual product name, description, attributes and English search');
  await page.getByRole('button', { name: '加入购物车', exact: true }).click();
  await visibleText(page, '已加入购物车');
  const cartEndpoint = 'http://127.0.0.1:3101/api/cart';
  let cartAttempts = 0;
  const failCartOnce = route => ++cartAttempts === 1
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) })
    : route.continue();
  expectedShoppingFailure = cartEndpoint;
  await page.route(cartEndpoint, failCartOnce);
  await page.goto('http://127.0.0.1:3100/cart');
  await visibleText(page, '加载购物车失败，请重试');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await visibleText(page, 'Unable to load your cart. Please try again.');
  assert.equal(await page.getByText('Your cart is empty', { exact: true }).count(), 0, 'failed loading never claims the cart is empty');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  assert.equal(cartAttempts, 2);
  await page.unroute(cartEndpoint, failCartOnce);
  expectedShoppingFailure = undefined;
  console.log('PASS browser cart 503 displays an error and explicit retry restores real items');
  await page.getByRole('checkbox', { name: 'Select Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser bilingual cart content');
  const checkoutRequests = [];
  let committedOrderId;
  const checkoutFaults = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    checkoutRequests.push(route.request().postDataJSON());
    if (checkoutRequests.length === 1) {
      // Commit through the real API, then lose only the browser response.
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      committedOrderId = (await response.json()).order_id;
      return route.abort('failed');
    }
    const status = [408, 429][checkoutRequests.length - 2];
    if (status) return route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': 'http://127.0.0.1:3100', 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ error: '暂时无法确认订单，请稍后重试' }),
    });
    return route.continue();
  };
  await page.route(checkoutEndpoint, checkoutFaults);
  expectedCheckoutFailure = true;
  await page.getByRole('button', { name: /^结算 \(1\)$/ }).click();
  const retryCheckout = () => page.getByRole('button', { name: '重试确认订单', exact: true });
  await retryCheckout().waitFor({ state: 'visible' });
  for (const status of [408, 429]) {
    const response = page.waitForResponse(response => response.url() === checkoutEndpoint && response.status() === status);
    await retryCheckout().click();
    await response;
    await retryCheckout().waitFor({ state: 'visible' });
  }
  await page.reload();
  await retryCheckout().click();
  await page.waitForURL(/\/orders\/\d+$/);
  expectedCheckoutFailure = false;
  await page.unroute(checkoutEndpoint, checkoutFaults);
  assert.equal(page.url(), `http://127.0.0.1:3100/orders/${committedOrderId}`);
  assert.equal(checkoutRequests.length, 4);
  for (const input of checkoutRequests) assert.deepEqual(input, checkoutRequests[0]);
  const orders = await context.request.get(checkoutEndpoint);
  assert.equal(orders.status(), 200);
  assert.equal((await orders.json()).total, 1, 'one persisted order after lost and blocked responses');
  const product = await context.request.get('http://127.0.0.1:3101/api/products/1');
  assert.equal(product.status(), 200);
  assert.equal((await product.json()).product.stock, 19, 'fixture stock deducted exactly once');
  console.log('PASS browser lost checkout response, HTTP 408/429 and reload preserve one order and stock deduction');
  const orderUrl = page.url();
  const detailEndpoint = `${checkoutEndpoint}/${committedOrderId}`;
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  const bilingualOrder = await context.request.get(detailEndpoint);
  assert.equal(bilingualOrder.status(), 200);
  const bilingualItem = (await bilingualOrder.json()).items[0];
  assert.equal(bilingualItem.product_name, '浏览器交易测试商品');
  assert.equal(bilingualItem.product_name_en, 'Browser checkout product');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser bilingual order snapshot');
  const apiHeaders = { 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3100' };
  for (const id of [`${committedOrderId}abc`, '1e3']) {
    for (const [method, suffix] of [['get', ''], ['get', '/remaining-time'], ['post', '/cancel'], ['post', '/pay'], ['post', '/confirm']]) {
      const rejected = await context.request[method](`${checkoutEndpoint}/${id}${suffix}`, { headers: apiHeaders });
      assert.equal(rejected.status(), 400);
      assert.equal((await rejected.json()).error, '订单ID无效');
    }
  }
  const unchangedOrder = await context.request.get(detailEndpoint);
  assert.equal((await unchangedOrder.json()).order.status, 0);
  const unchangedStock = await context.request.get('http://127.0.0.1:3101/api/products/1');
  assert.equal((await unchangedStock.json()).product.stock, 19);
  console.log('PASS browser malformed order IDs leave the persisted order and stock unchanged');
  let detailFailures = 0;
  const failDetailOnce = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    detailFailures++;
    if (detailFailures === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '服务暂不可用' }), headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true' } });
    return route.continue();
  };
  expectedOrderDetailFailure = detailEndpoint;
  await page.route(detailEndpoint, failDetailOnce);
  await page.reload();
  await page.getByRole('alert').filter({ hasText: '加载订单详情失败，请重试' }).waitFor({ state: 'visible' });
  assert.equal(page.url(), orderUrl, 'temporary failure retains the detail route');
  const reloadedDetail = page.waitForResponse(response => response.url() === detailEndpoint && response.status() === 200);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await reloadedDetail;
  await visibleText(page, '订单详情');
  assert.equal(page.url(), orderUrl);
  assert.equal(detailFailures, 2, 'one explicit retry after one failure');
  await page.unroute(detailEndpoint, failDetailOnce);
  expectedOrderDetailFailure = undefined;
  console.log('PASS browser order detail survives a 503 and reloads on explicit retry');
  await page.getByRole('button', { name: '模拟支付', exact: true }).click();
  await visibleText(page, '演示订单');
  await visibleText(page, '已支付');
  console.log('PASS browser checkout and explicit demo payment');
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  admin.on('pageerror', error => errors.push(error.message));
  watchConsole(admin, 'admin');
  await admin.goto('http://127.0.0.1:3100/admin/login');
  await admin.locator('input[type="text"]').fill('admin');
  await admin.locator('input[type="password"]').fill('BrowserFixtureAdmin123!');
  await admin.getByRole('button', { name: '登录', exact: true }).click();
  await admin.waitForURL(/\/admin\/dashboard$/);
  await admin.goto('http://127.0.0.1:3100/admin/orders');
  await admin.getByRole('button', { name: '发货', exact: true }).first().click();
  await admin.getByLabel('快递公司').fill('测试快递');
  await admin.getByLabel('运单号').fill('E2E-TRACK-123');
  await admin.getByRole('button', { name: '确认发货', exact: true }).click();
  await page.goto(orderUrl);
  await visibleText(page, 'E2E-TRACK-123');
  await page.getByRole('button', { name: '确认收货', exact: true }).click();
  await visibleText(page, '已完成');
  console.log('PASS browser admin shipment and customer receipt');
  await page.goto('http://127.0.0.1:3100/orders?status=0');
  await visibleText(page, '暂无订单');
  const allOrders = page.getByRole('button', { name: '全部', exact: true });
  assert.ok((await page.getByRole('button', { name: '待支付', exact: true }).getAttribute('class')).includes('bg-primary-600'));
  await page.locator('header a[href="/orders"]').click();
  await page.waitForURL('http://127.0.0.1:3100/orders');
  await page.getByRole('link', { name: '查看详情', exact: true }).waitFor({ state: 'visible' });
  assert.ok((await allOrders.getAttribute('class')).includes('bg-primary-600'));
  await page.getByRole('button', { name: '已取消', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/orders?status=4');
  await visibleText(page, '暂无订单');
  await page.reload();
  await visibleText(page, '暂无订单');
  assert.ok((await page.getByRole('button', { name: '已取消', exact: true }).getAttribute('class')).includes('bg-primary-600'));
  await page.goBack();
  await page.waitForURL('http://127.0.0.1:3100/orders');
  await page.getByRole('link', { name: '查看详情', exact: true }).waitFor({ state: 'visible' });
  await page.goForward();
  await page.waitForURL('http://127.0.0.1:3100/orders?status=4');
  await visibleText(page, '暂无订单');
  console.log('PASS browser order status follows Header navigation, reload and Back/Forward');
  await page.goto(orderUrl);
  await visibleText(page, '已完成');
  await page.getByLabel('申请原因').fill('仅浏览器测试的售后原因');
  await page.getByRole('button', { name: '提交申请', exact: true }).click();
  await visibleText(page, '待审核');
  await admin.goto('http://127.0.0.1:3100/admin/after-sales');
  await visibleText(admin, '仅浏览器测试的售后原因');
  await admin.getByRole('button', { name: '通过审核', exact: true }).first().click();
  await admin.getByLabel('审核说明').fill('仅审核通过，不产生真实退款');
  await admin.getByRole('button', { name: '保存审核结果', exact: true }).click();
  await page.goto(orderUrl);
  await visibleText(page, '审核通过');
  await visibleText(page, '不会自动退款');
  console.log('PASS browser after-sales request and admin approval without refund');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/commerce-after-sales.png'), fullPage: true });
  await page.goto('http://127.0.0.1:3100/forgot-password');
  await visibleText(page, '密码找回邮件服务暂不可用');
  assert.equal(await page.getByRole('button', { name: '发送重置邮件', exact: true }).isDisabled(), true);
  await page.goto('http://127.0.0.1:3100/profile/settings');
  await page.getByLabel('当前密码', { exact: true }).fill('BrowserCustomer123!');
  await page.getByLabel('新密码', { exact: true }).fill('BrowserUpdated456!');
  await page.getByLabel('确认新密码', { exact: true }).fill('BrowserUpdated456!');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.waitForURL(/\/login\?passwordChanged=1$/);
  await page.locator('input[type="email"]').fill(customerEmail);
  await page.locator('input[type="password"]').fill('BrowserCustomer123!');
  expectedLoginFailure = true;
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await visibleText(page, '邮箱或密码错误');
  expectedLoginFailure = false;
  await page.locator('input[type="password"]').fill('BrowserUpdated456!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  console.log('PASS browser password change revokes session');
  assert.deepEqual(errors, [], 'browser runtime errors');
  assert.deepEqual(consoleErrors, [], 'browser console errors');
  console.log('PASS browser console has no unexpected errors');
  await adminContext.close();
  await context.close();
})().catch(async error => {
  console.error(error); console.error(lastLogs); process.exitCode = 1;
  if (browser) {
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    let index = 0;
    for (const context of browser.contexts()) for (const page of context.pages()) {
      await page.screenshot({ path: path.join(root, 'test-results', `commerce-failure-${index++}.png`), fullPage: true }).catch(() => {});
    }
  }
}).finally(async () => {
  if (browser) await browser.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 8000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});
