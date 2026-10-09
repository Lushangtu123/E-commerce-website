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
let expectedReadFailure;
let expectedFavoriteWriteEndpoint;
let expectedRecoveryWrite;
function watchConsole(page, label) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expectedLoginFailure && expectedLoginErrors.some(pattern => pattern.test(text))) return;
    if (expectedCheckoutFailure && message.location().url === checkoutEndpoint && expectedCheckoutErrors.some(pattern => pattern.test(text))) return;
    if (expectedFavoriteWriteEndpoint && message.location().url === expectedFavoriteWriteEndpoint && /^Failed to load resource: net::ERR_FAILED$/.test(text)) return;
    if (expectedRecoveryWrite && (message.location().url === expectedRecoveryWrite.endpoint && /^Failed to load resource: net::ERR_FAILED$/.test(text) || expectedRecoveryWrite.prefix && text.startsWith(expectedRecoveryWrite.prefix))) return;
    if (expectedOrderDetailFailure &&
        (message.location().url === expectedOrderDetailFailure && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) || /^加载订单失败:/.test(text))) return;
    if (expectedShoppingFailure &&
        (message.location().url === expectedShoppingFailure && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) || /^加载(?:商品|购物车)失败:/.test(text))) return;
    if (expectedReadFailure &&
        (message.location().url.split('?')[0] === expectedReadFailure.endpoint && /^Failed to load resource: the server responded with a status of 503(?: \([^)]*\))?$/.test(text) ||
         expectedReadFailure.prefix && text.startsWith(expectedReadFailure.prefix))) return;
    consoleErrors.push(`[${label}] ${new URL(page.url()).pathname}: ${text.slice(0, 300)}`);
  });
}
async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
}
async function localPlatformScripts(context) {
  // These platform-served scripts are absent from a local Next production server.
  // Supply only those exact scripts; unexpected console and application failures remain fatal.
  for (const script of ['insights', 'speed-insights']) {
    await context.route(`http://127.0.0.1:3100/_vercel/${script}/script.js`, route => route.fulfill({
      status: 200, contentType: 'application/javascript', body: '/* local platform script fixture */',
    }));
  }
}
(async () => {
  const fixture = start(process.execPath, ['scripts/e2e-server.cjs'], backend, {});
  await ready('http://127.0.0.1:3101/api/products', fixture);
  const production = process.env.ECOMMERCE_E2E_PRODUCTION === 'true';
  const frontend = start(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', '-p', '3100', '-H', '127.0.0.1'], root, {
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3101/api', ECOMMERCE_SERVERLESS_API: 'false',
    NODE_ENV: production ? 'production' : 'development', VERCEL: '', VERCEL_ENV: '', NEXT_TELEMETRY_DISABLED: '1',
  });
  await ready('http://127.0.0.1:3100/register', frontend);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await localPlatformScripts(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  watchConsole(page, 'customer');
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:3100/');
  await page.getByRole('heading', { name: '欢迎来到电商平台', exact: true }).waitFor({ state: 'visible' });
  await page.locator('section').filter({ has: page.getByRole('heading', { name: '热门商品', exact: true }) }).locator('a[href="/products/1"]').waitFor({ state: 'visible' });
  console.log('PASS browser fresh anonymous homepage hydrates before registration');
  await page.goto('http://127.0.0.1:3100/register');
  const customerUsername = `browser${Date.now()}`;
  await page.locator('input[name="username"]').fill(customerUsername);
  const customerEmail = `browser${Date.now()}@example.test`;
  await page.locator('input[name="email"]').fill(customerEmail);
  await page.locator('input[name="password"]').fill('BrowserCustomer123!');
  await page.locator('input[name="confirmPassword"]').fill('BrowserCustomer123!');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  console.log('PASS browser registration');
  await page.goto('http://127.0.0.1:3100/products');
  const ordinaryCard = page.locator('a[href="/products/1"]').filter({ has: page.getByRole('heading', { name: '浏览器交易测试商品', exact: true }) }).first();
  const cardAdd = ordinaryCard.getByRole('button', { name: '加入', exact: true });
  await cardAdd.waitFor({ state: 'visible' });
  // The card is present in SSR HTML before the persisted customer's session has hydrated.
  await page.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
  let releaseCardRead, cardReadReady, cardReads = 0, cardWrites = 0;
  const cardReadGate = new Promise(resolve => { releaseCardRead = resolve; });
  const cardReadStarted = new Promise(resolve => { cardReadReady = resolve; });
  const cardEndpoint = 'http://127.0.0.1:3101/api/products/1';
  const delayCardRead = async route => { cardReads++; cardReadReady(); await cardReadGate; return route.continue(); };
  const countCardWrites = request => { if (request.method() === 'POST' && request.url() === 'http://127.0.0.1:3101/api/cart') cardWrites++; };
  page.on('request', countCardWrites); await page.route(cardEndpoint, delayCardRead);
  await cardAdd.evaluate(button => { button.click(); button.click(); });
  await cardReadStarted;
  assert.equal(await ordinaryCard.getByRole('button', { name: '处理中...', exact: true }).isDisabled(), true);
  const cardWriteCompleted = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === 'http://127.0.0.1:3101/api/cart');
  releaseCardRead(); assert.equal((await cardWriteCompleted).status(), 200);
  await cardAdd.click({ trial: true });
  const cardCart = await context.request.get('http://127.0.0.1:3101/api/cart'); assert.equal(cardCart.status(), 200);
  const cardRows = (await cardCart.json()).items.filter(item => item.product_id === 1);
  assert.equal(cardReads, 1); assert.equal(cardWrites, 1); assert.equal(cardRows.length, 1); assert.equal(cardRows[0].quantity, 1);
  await page.unroute(cardEndpoint, delayCardRead); page.off('request', countCardWrites);
  const clearCardFixture = await context.request.delete('http://127.0.0.1:3101/api/cart/1', { headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3100' } });
  assert.equal(clearCardFixture.status(), 200);
  await page.goto('http://127.0.0.1:3100/');
  console.log('PASS browser repeated same-task card events create one real cart increment');
  const hotEndpoint = 'http://127.0.0.1:3101/api/products/hot';
  let hotUnavailable = true, hotAttempts = 0;
  const hotFault = route => { hotAttempts++; return hotUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) }) : route.continue(); };
  expectedReadFailure = { endpoint: hotEndpoint, prefix: '加载热门商品失败，请重试' };
  await page.route(`${hotEndpoint}*`, hotFault);
  await page.goto('http://127.0.0.1:3100/');
  const hotSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '热门商品', exact: true }) });
  const newSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '新品推荐', exact: true }) });
  await hotSection.getByRole('alert').waitFor({ state: 'visible' });
  await newSection.locator('a[href="/products/1"]').waitFor({ state: 'visible' });
  assert.equal(await hotSection.locator('a[href="/products/1"]').count(), 0);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await visibleText(page, 'Unable to load popular products. Please try again.');
  const beforeHotRetry = hotAttempts; hotUnavailable = false;
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Best sellers', exact: true }) }).getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Best sellers', exact: true }) }).locator('a[href="/products/1"]').waitFor({ state: 'visible' });
  assert.equal(hotAttempts, beforeHotRetry + 1);
  await page.unroute(`${hotEndpoint}*`, hotFault); expectedReadFailure = undefined;
  await page.reload();
  await page.getByRole('heading', { name: 'Welcome to our shop', exact: true }).waitFor({ state: 'visible' });
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Best sellers', exact: true }) }).locator('a[href="/products/1"]').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('combobox', { name: 'Interface language', exact: true }).inputValue(), 'en');
  console.log('PASS browser persisted English preference survives homepage hydration');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser independent homepage failure preserves new arrivals and bilingual retry recovers hot products');
  const couponsEndpoint = 'http://127.0.0.1:3101/api/coupons/available';
  let couponAttempts = 0;
  const couponFault = async route => {
    couponAttempts++;
    if (couponAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '获取优惠券列表失败' }) });
    await route.continue();
  };
  expectedReadFailure = { endpoint: couponsEndpoint };
  await page.route(`${couponsEndpoint}*`, couponFault);
  await page.goto('http://127.0.0.1:3100/coupons');
  await page.getByRole('alert').getByText('获取优惠券列表失败', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('暂无可领取的优惠券', { exact: true }).count(), 0);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Reload coupons', exact: true }).click();
  await visibleText(page, '51 coupons in total');
  assert.equal(couponAttempts, 2);
  await page.unroute(`${couponsEndpoint}*`, couponFault); expectedReadFailure = undefined;
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('浏览器优惠券1', { exact: true }).waitFor({ state: 'visible' });
  await visibleText(page, '第 2 / 2 页');
  const couponWriteEndpoint = 'http://127.0.0.1:3101/api/coupons/receive';
  const claimBodies = [];
  const lostClaim = async route => {
    claimBodies.push(route.request().postDataJSON());
    const response = await route.fetch(); assert.equal(response.status(), 200);
    return claimBodies.length === 1 ? route.abort('failed') : route.fulfill({ response });
  };
  expectedRecoveryWrite = { endpoint: couponWriteEndpoint, prefix: '领取失败:' };
  await page.route(couponWriteEndpoint, lostClaim);
  await page.getByRole('button', { name: '立即领取', exact: true }).click();
  await visibleText(page, '领取结果尚未确认，重试不会重复领取');
  await page.reload();
  await page.getByRole('button', { name: '重试领取', exact: true }).click();
  await visibleText(page, '领取成功！');
  assert.equal(claimBodies.length, 2); assert.ok(claimBodies[0].claim_key);
  assert.equal(claimBodies[1].claim_key, claimBodies[0].claim_key);
  const claimReceipts = (await (await context.request.get('http://127.0.0.1:3101/api/coupons/my/list')).json()).data;
  assert.equal(claimReceipts.filter(value => value.coupon_id === claimBodies[0].coupon_id).length, 1);
  await page.unroute(couponWriteEndpoint, lostClaim); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost coupon response recovers one real receipt after last allocation disappears and reload');
  await visibleText(page, '共 50 张优惠券');
  await page.getByText('浏览器优惠券51', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('浏览器优惠券1', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).count(), 0);
  console.log('PASS browser coupon center 503 retry, bilingual controls and real 51-coupon pagination');
  const myCouponsEndpoint = 'http://127.0.0.1:3101/api/coupons/my/list';
  let myCouponAttempts = 0;
  const myCouponFault = async route => {
    myCouponAttempts++;
    if (myCouponAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '获取用户优惠券失败' }) });
    await route.continue();
  };
  expectedReadFailure = { endpoint: myCouponsEndpoint };
  await page.route(`${myCouponsEndpoint}*`, myCouponFault);
  await page.goto('http://127.0.0.1:3100/my/coupons');
  await page.getByRole('alert').getByText('获取用户优惠券失败', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('暂无未使用的优惠券', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '重新加载优惠券', exact: true }).click();
  await page.getByText('浏览器优惠券1', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(myCouponAttempts, 2);
  await page.unroute(`${myCouponsEndpoint}*`, myCouponFault); expectedReadFailure = undefined;
  console.log('PASS browser my coupons 503 shows an error and retry restores the real claimed coupon');
  // The shared search header is already hydrated here. A full reload immediately before
  // typing can reset its input while the stored customer session is being restored.
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
  const deleteHistory = searchForm.getByRole('button', { name: `删除搜索历史：${searchKeyword}`, exact: true });
  await deleteHistory.focus();
  await deleteHistory.press('Enter');
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
  const favoriteCheckEndpoint = 'http://127.0.0.1:3101/api/favorites/check/2';
  let releaseFavoriteRead, favoriteReadReady;
  const favoriteGate = new Promise(resolve => { releaseFavoriteRead = resolve; });
  const favoriteStarted = new Promise(resolve => { favoriteReadReady = resolve; });
  const delayedFavoriteRead = async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200); favoriteReadReady();
    await favoriteGate; await route.fulfill({ response });
  };
  await page.route(favoriteCheckEndpoint, delayedFavoriteRead);
  await page.goto('http://127.0.0.1:3100/products/2');
  await favoriteStarted;
  assert.equal(await page.getByRole('button', { name: '收藏', exact: true }).isDisabled(), true);
  const completedFavoriteRead = page.waitForResponse(response => response.url() === favoriteCheckEndpoint);
  releaseFavoriteRead(); await completedFavoriteRead;
  await page.unroute(favoriteCheckEndpoint, delayedFavoriteRead);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('button', { name: '取消收藏', exact: true }).waitFor({ state: 'visible' });
  assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, true);
  let favoriteUnavailable = true, favoriteAttempts = 0;
  const favoriteFault = route => { favoriteAttempts++; return favoriteUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic unavailable' }) }) : route.continue(); };
  expectedReadFailure = { endpoint: favoriteCheckEndpoint, prefix: '检查收藏状态失败:' };
  await page.route(favoriteCheckEndpoint, favoriteFault);
  await page.reload();
  await page.getByRole('alert').filter({ hasText: '加载收藏状态失败，请重试' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '收藏', exact: true }).isDisabled(), true);
  assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, true);
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await visibleText(page, 'Unable to load favorite status. Please try again.');
  const beforeFavoriteRetry = favoriteAttempts; favoriteUnavailable = false;
  await page.getByRole('button', { name: 'Retry favorite status', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor({ state: 'visible' });
  assert.equal(favoriteAttempts, beforeFavoriteRetry + 1);
  assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, true);
  await page.unroute(favoriteCheckEndpoint, favoriteFault); expectedReadFailure = undefined;
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.getByRole('button', { name: '收藏', exact: true }).waitFor({ state: 'visible' });
  assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, false);
  console.log('PASS browser favorite reads block premature mutation and recover without removing an existing favorite');
  for (const locale of ['zh-CN', 'en']) {
    await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption(locale);
    for (const selected of [true, false]) {
      const endpoint = `http://127.0.0.1:3101/api/favorites${selected ? '' : '/2'}`;
      const method = selected ? 'POST' : 'DELETE';
      let writes = 0;
      const loseCommittedFavoriteResponse = async route => {
        if (route.request().method() !== method) return route.continue();
        writes++;
        const response = await route.fetch(); assert.equal(response.status(), 200);
        return route.abort('failed');
      };
      await page.route(endpoint, loseCommittedFavoriteResponse); expectedFavoriteWriteEndpoint = endpoint;
      await page.getByRole('button', { name: locale === 'en' ? (selected ? 'Add to favorites' : 'Remove from favorites') : (selected ? '收藏' : '取消收藏'), exact: true }).click();
      const recovered = page.getByRole('button', { name: locale === 'en' ? (selected ? 'Remove from favorites' : 'Add to favorites') : (selected ? '取消收藏' : '收藏'), exact: true });
      await recovered.click({ trial: true });
      assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, selected);
      assert.equal(writes, 1, 'response loss does not repeat a committed favorite write');
      await page.unroute(endpoint, loseCommittedFavoriteResponse); expectedFavoriteWriteEndpoint = undefined;
    }
  }
  console.log('PASS browser explicit favorite add/remove reconcile lost committed responses in both languages');
  let recoveryReadUnavailable = true, recoveredWrites = 0;
  const lostFavoriteAdd = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    recoveredWrites++; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed');
  };
  const recoveryReadFault = route => recoveryReadUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '检查收藏状态失败' }) }) : route.continue();
  const favoriteAddEndpoint = 'http://127.0.0.1:3101/api/favorites';
  expectedFavoriteWriteEndpoint = favoriteAddEndpoint; expectedReadFailure = { endpoint: favoriteCheckEndpoint, prefix: '检查收藏状态失败:' };
  await page.route(favoriteAddEndpoint, lostFavoriteAdd); await page.route(favoriteCheckEndpoint, recoveryReadFault);
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Unable to load favorite status. Please try again.' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Add to favorites', exact: true }).isDisabled(), true);
  recoveryReadUnavailable = false;
  await page.getByRole('button', { name: 'Retry favorite status', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from favorites', exact: true }).click({ trial: true });
  assert.equal(recoveredWrites, 1);
  assert.equal((await (await context.request.get(favoriteCheckEndpoint)).json()).is_favorited, true);
  await page.unroute(favoriteAddEndpoint, lostFavoriteAdd); await page.unroute(favoriteCheckEndpoint, recoveryReadFault);
  expectedFavoriteWriteEndpoint = undefined; expectedReadFailure = undefined;
  await page.getByRole('button', { name: 'Remove from favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click({ trial: true });
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser favorite reconciliation outage provides read-only retry and preserves the committed intent');
  await page.goto('http://127.0.0.1:3100/history');
  for (const locale of ['zh-CN', 'en']) {
    await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption(locale);
    const opener = page.getByRole('button', { name: locale === 'en' ? 'Clear history' : '清空历史', exact: true });
    await opener.click();
    const confirmation = page.getByRole('alertdialog'); await confirmation.waitFor({ state: 'visible' });
    assert.equal(await confirmation.evaluate(element => element.matches(':modal')), true);
    await page.keyboard.press('Tab');
    assert.equal(await confirmation.getByRole('button', { name: locale === 'en' ? 'Cancel' : '取消', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await confirmation.getByRole('button', { name: locale === 'en' ? 'OK' : '确定', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.locator('header input').first().evaluate(element => element.focus());
    assert.equal(await confirmation.evaluate(element => element.contains(document.activeElement)), true, 'background input stays inert');
    await confirmation.locator('p').click();
    assert.equal(await confirmation.isVisible(), true);
    await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'hidden' });
    await page.waitForFunction(element => element === document.activeElement, await opener.elementHandle());
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    await opener.click(); await confirmation.waitFor({ state: 'visible' });
    await confirmation.click({ position: { x: 4, y: 4 } }); await confirmation.waitFor({ state: 'hidden' });
    await page.waitForFunction(element => element === document.activeElement, await opener.elementHandle());
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  }
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser bilingual confirmation contains Tab focus, blocks background focus and restores the opener');
  const reviewEndpoint = 'http://127.0.0.1:3101/api/reviews/product/2';
  let reviewsUnavailable = true, reviewAttempts = 0;
  const reviewFault = route => { reviewAttempts++; return reviewsUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) }) : route.continue(); };
  expectedReadFailure = { endpoint: reviewEndpoint, prefix: '加载评论失败:' };
  await page.route(`${reviewEndpoint}*`, reviewFault);
  await page.goto('http://127.0.0.1:3100/products/2');
  const reviewsSection = page.getByRole('heading', { name: '用户评价', exact: true }).locator('..');
  await reviewsSection.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await reviewsSection.getByText('暂无评价', { exact: true }).count(), 0);
  const beforeReviewRetry = reviewAttempts; reviewsUnavailable = false;
  await reviewsSection.getByRole('button', { name: '重新加载', exact: true }).click();
  await reviewsSection.getByText('暂无评价', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(reviewAttempts, beforeReviewRetry + 1);
  await page.unroute(`${reviewEndpoint}*`, reviewFault); expectedReadFailure = undefined;
  console.log('PASS browser review read failure has its own retry and a real empty state after recovery');
  const pagedReviews = route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    const reviews = Array.from({ length: Math.min(5, 12 - (pageNumber - 1) * 5) }, (_, index) => ({
      review_id: (pageNumber - 1) * 5 + index + 1, rating: 4, username: 'Browser fixture',
      content: `Synthetic review ${(pageNumber - 1) * 5 + index + 1}`, created_at: '2026-10-07T00:00:00Z',
    }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews, total: 12, page: pageNumber, limit: 5, totalPages: 3 }) });
  };
  await page.route(`${reviewEndpoint}*`, pagedReviews);
  await page.reload();
  await visibleText(page, 'Synthetic review 1');
  await reviewsSection.getByRole('button', { name: '下一页', exact: true }).click();
  await reviewsSection.getByText('Synthetic review 6', { exact: true }).waitFor({ state: 'visible' });
  await reviewsSection.getByRole('button', { name: '下一页', exact: true }).click();
  await reviewsSection.getByText('Synthetic review 12', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await reviewsSection.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  await page.unroute(`${reviewEndpoint}*`, pagedReviews);
  console.log('PASS browser product review pagination reaches all twelve controlled reviews');
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
  const relatedEndpoint = 'http://127.0.0.1:3101/api/recommendations/related/2';
  let relatedUnavailable = true, relatedAttempts = 0;
  const relatedFault = route => { relatedAttempts++; return relatedUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) }) : route.continue(); };
  const neighboringReads = { product: 0, reviews: 0, favorite: 0, browse: 0 };
  const countRelatedNeighbors = request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/products/2') neighboringReads.product++;
    if (request.method() === 'GET' && pathname === '/api/reviews/product/2') neighboringReads.reviews++;
    if (request.method() === 'GET' && pathname === '/api/favorites/check/2') neighboringReads.favorite++;
    if (request.method() === 'POST' && pathname === '/api/browse/record') neighboringReads.browse++;
  };
  page.on('request', countRelatedNeighbors);
  expectedReadFailure = { endpoint: relatedEndpoint, prefix: '加载相关推荐失败:' };
  await page.route(`${relatedEndpoint}*`, relatedFault); await page.reload();
  const relatedSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(相关推荐|Related products)$/ }) });
  await relatedSection.getByRole('alert').waitFor({ state: 'visible' });
  await variant.selectOption('201');
  await page.getByRole('button', { name: '收藏', exact: true }).click({ trial: true });
  await reviewsSection.getByText('暂无评价', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await relatedSection.getByText('Unable to load recommendations. Please try again.', { exact: true }).waitFor({ state: 'visible' });
  const beforeRelatedRetry = { ...neighboringReads }, previousRelatedAttempts = relatedAttempts;
  relatedUnavailable = false; await relatedSection.getByRole('button', { name: 'Retry', exact: true }).click();
  await relatedSection.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  assert.equal(relatedAttempts, previousRelatedAttempts + 1);
  assert.deepEqual(neighboringReads, beforeRelatedRetry, 'retry only reloads related products');
  assert.equal(await page.getByLabel('Product options', { exact: true }).inputValue(), '201');
  await page.unroute(`${relatedEndpoint}*`, relatedFault); expectedReadFailure = undefined;
  page.off('request', countRelatedNeighbors);
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser bilingual related-product retry preserves SKU selection and leaves neighboring requests untouched');
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
  await page.waitForFunction(() => document.title === 'Browser checkout product | Shop');
  await page.reload();
  await page.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.title === 'Browser checkout product | Shop');
  await page.goto('http://127.0.0.1:3100/products/2');
  await page.getByRole('heading', { name: 'Browser variant product', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.title === 'Browser variant product | Shop');
  await page.goto('http://127.0.0.1:3100/products/1');
  await page.getByRole('heading', { name: 'Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.title === 'Browser checkout product | Shop');
  const englishSearch = await context.request.get('http://127.0.0.1:3101/api/products?keyword=Browser%20checkout');
  assert.equal(englishSearch.status(), 200);
  assert.equal((await englishSearch.json()).products.some(product => product.product_id === 1), true);
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await visibleText(page, '浏览器中文描述');
  await page.waitForFunction(() => document.title === '浏览器交易测试商品 | 电商平台');
  console.log('PASS browser product titles follow language, reload and product navigation');
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
  let uncertainCartWrites = 0;
  const loseCartWriteReply = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    uncertainCartWrites++;
    const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.abort('failed');
  };
  expectedRecoveryWrite = { endpoint: cartEndpoint };
  await page.route(cartEndpoint, loseCartWriteReply);
  await page.getByRole('button', { name: '+', exact: true }).click();
  await visibleText(page, '2 items');
  assert.equal(uncertainCartWrites, 1);
  const recoveredCart = await (await context.request.get(cartEndpoint)).json();
  assert.equal(recoveredCart.items[0].quantity, 2);
  await page.unroute(cartEndpoint, loseCartWriteReply); expectedRecoveryWrite = undefined;
  console.log('PASS browser committed cart quantity with a lost reply rereads real MySQL without repeating the write');
  await page.unroute(cartEndpoint, failCartOnce);
  expectedShoppingFailure = undefined;
  console.log('PASS browser cart 503 displays an error and explicit retry restores real items');
  await page.getByRole('checkbox', { name: 'Select Browser checkout product', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await visibleText(page, '2 件');
  await page.getByRole('button', { name: '-', exact: true }).click();
  await visibleText(page, '1 件');
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
  await localPlatformScripts(adminContext);
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  admin.on('pageerror', error => errors.push(error.message));
  watchConsole(admin, 'admin');
  await admin.goto('http://127.0.0.1:3100/admin/login');
  await admin.locator('input[type="text"]').fill('admin');
  await admin.locator('input[type="password"]').fill('BrowserFixtureAdmin123!');
  await admin.getByRole('button', { name: '登录', exact: true }).click();
  await admin.waitForURL(/\/admin\/dashboard$/);
  const dashboardOrdersEndpoint = 'http://127.0.0.1:3101/api/admin/dashboard/recent-orders';
  let dashboardReads = 0, dashboardUnavailable = true;
  const dashboardFault = route => { dashboardReads++; return dashboardUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '获取订单失败' }) }) : route.continue(); };
  expectedReadFailure = { endpoint: dashboardOrdersEndpoint, prefix: '获取数据失败:' };
  await admin.route(`${dashboardOrdersEndpoint}*`, dashboardFault);
  await admin.goto('http://127.0.0.1:3100/admin/dashboard');
  const recentOrdersRegion = admin.getByRole('heading', { name: '最近订单', exact: true }).locator('..').locator('..');
  await recentOrdersRegion.getByRole('alert').getByText('获取订单失败', { exact: true }).waitFor({ state: 'visible' });
  const beforeDashboardRetry = dashboardReads; dashboardUnavailable = false;
  await recentOrdersRegion.getByRole('button', { name: '重新加载', exact: true }).click();
  await recentOrdersRegion.getByRole('table').waitFor({ state: 'visible' });
  assert.equal(dashboardReads, beforeDashboardRetry + 1);
  await admin.unroute(`${dashboardOrdersEndpoint}*`, dashboardFault); expectedReadFailure = undefined;
  console.log('PASS browser dashboard region retry restores real orders');
  const realOrderNo = (await (await context.request.get(detailEndpoint)).json()).order.order_no;
  for (const [kind, label, keyword, parameter] of [
    ['products', '搜索商品', 'Browser', 'keyword'], ['users', '搜索用户', 'browser', 'keyword'], ['orders', '订单号', realOrderNo.slice(0, 6), 'orderNo'],
  ]) {
    await admin.goto(`http://127.0.0.1:3100/admin/${kind}`);
    await admin.getByRole('table').waitFor({ state: 'visible' });
    const reads = [];
    const track = request => { if (new URL(request.url()).pathname === `/api/admin/${kind}` && request.method() === 'GET') reads.push(request.url()); };
    admin.on('request', track);
    const input = admin.getByRole('textbox', { name: label, exact: true });
    await input.pressSequentially(keyword);
    assert.deepEqual(reads, [], 'typing a draft never reads the admin list');
    const submitted = admin.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/${kind}` && response.request().method() === 'GET');
    await input.press('Enter');
    assert.equal((await submitted).status(), 200);
    await admin.getByRole('table').waitFor({ state: 'visible' });
    assert.equal(reads.length, 1);
    assert.equal(new URL(reads[0]).searchParams.get(parameter), keyword);
    assert.equal(new URL(reads[0]).searchParams.get('page'), '1');
    admin.off('request', track);
  }
  console.log('PASS browser all three admin keyword drafts submit one list request on Enter');
  const categoriesEndpoint = 'http://127.0.0.1:3101/api/products/categories';
  // The real browser owns native modality: happy-dom cannot emulate focus containment.
  for (const locale of ['zh-CN', 'en']) {
    for (const kind of ['products', 'coupons']) {
      await admin.goto(`http://127.0.0.1:3100/admin/${kind}`);
      await admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption(locale);
      const opener = admin.getByRole('button', { name: kind === 'products'
        ? locale === 'en' ? 'Add product' : '添加商品' : locale === 'en' ? '+ Create coupon' : '+ 创建优惠券', exact: true }).first();
      await opener.focus(); await opener.click();
      const dialog = admin.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
      fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
      await admin.screenshot({ path: path.join(root, 'test-results', `admin-${kind}-dialog-${locale}.png`), fullPage: true });
      await dialog.locator('button:enabled').last().focus(); await admin.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Tab stays inside the editor');
      await dialog.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).focus(); await admin.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Shift+Tab stays inside the editor');
      await admin.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await opener.evaluate(element => document.activeElement === element), true, 'Escape restores the opener');
      await opener.click(); await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await opener.evaluate(element => document.activeElement === element), true);
    }
  }
  await admin.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser bilingual editor modality, Tab containment, Escape and close restore focus');
  await admin.goto('http://127.0.0.1:3100/admin/products');
  await admin.getByRole('button', { name: '添加商品', exact: true }).first().click();
  const pendingEditor = admin.getByRole('dialog');
  await pendingEditor.locator('#newProduct-title').fill('Browser keyboard editor product');
  await pendingEditor.locator('#newProduct-price').fill('12.50');
  await pendingEditor.locator('#newProduct-category-id option[value="1"]').waitFor({ state: 'attached' });
  await pendingEditor.locator('#newProduct-category-id').selectOption('1');
  let releaseEditorSave, editorSaveStarted;
  const editorSaveGate = new Promise(resolve => { releaseEditorSave = resolve; });
  const editorStarted = new Promise(resolve => { editorSaveStarted = resolve; });
  const editorWritesEndpoint = 'http://127.0.0.1:3101/api/admin/products';
  const delayEditorSave = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    editorSaveStarted(); await editorSaveGate; await route.continue();
  };
  await admin.route(editorWritesEndpoint, delayEditorSave);
  const editorSaved = admin.waitForResponse(response => response.url() === editorWritesEndpoint && response.request().method() === 'POST');
  await pendingEditor.getByRole('button', { name: '添加商品', exact: true }).click(); await editorStarted;
  await admin.keyboard.press('Escape');
  assert.equal(await pendingEditor.isVisible(), true);
  assert.equal(await pendingEditor.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
  assert.equal(await pendingEditor.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  releaseEditorSave(); assert.equal((await editorSaved).status(), 201);
  await pendingEditor.waitFor({ state: 'hidden' }); await admin.unroute(editorWritesEndpoint, delayEditorSave);
  console.log('PASS browser native editor ignores Escape during an in-flight save');
  let categoryAttempts = 0, releaseCategoryRetry;
  const categoryRetryGate = new Promise(resolve => { releaseCategoryRetry = resolve; });
  const categoryFault = async route => {
    categoryAttempts++;
    if (categoryAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '获取分类列表失败' }) });
    await categoryRetryGate;
    return route.continue();
  };
  expectedReadFailure = { endpoint: categoriesEndpoint, prefix: '获取分类失败:' };
  await admin.route(categoriesEndpoint, categoryFault);
  await admin.goto('http://127.0.0.1:3100/admin/products');
  await admin.getByRole('table').waitFor({ state: 'visible' });
  await admin.getByRole('button', { name: '添加商品', exact: true }).click();
  await admin.getByRole('alert').getByText('获取分类失败，请重新加载', { exact: true }).waitFor({ state: 'visible' });
  await admin.locator('#newProduct-title').fill('Category recovery draft');
  await admin.locator('#newProduct-price').fill('19.90');
  assert.equal(await admin.locator('#newProduct-category-id').isDisabled(), true);
  await admin.getByRole('dialog').getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await admin.getByRole('alert').getByText('Categories could not be loaded. Please reload.', { exact: true }).waitFor({ state: 'visible' });
  await admin.getByRole('button', { name: 'Reload categories', exact: true }).click();
  await admin.getByRole('status').getByText('Loading categories...', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await admin.getByRole('button', { name: 'Add product', exact: true }).last().isDisabled(), true);
  assert.equal(await admin.locator('#newProduct-title').inputValue(), 'Category recovery draft');
  releaseCategoryRetry();
  await admin.locator('#newProduct-category-id option[value="1"]').waitFor({ state: 'attached' });
  assert.equal(await admin.locator('#newProduct-category-id').isEnabled(), true);
  assert.equal(await admin.locator('#newProduct-title').inputValue(), 'Category recovery draft');
  assert.equal(await admin.locator('#newProduct-price').inputValue(), '19.90');
  assert.equal(categoryAttempts, 2);
  await admin.getByRole('button', { name: 'Cancel', exact: true }).click();
  await admin.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await admin.unroute(categoriesEndpoint, categoryFault); expectedReadFailure = undefined;
  console.log('PASS browser category outage, bilingual retry and loading preserve the product draft');
  const creationBodies = [], creationIds = [];
  const loseFirstCreationReply = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    creationBodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    creationIds.push((await response.json()).product_id);
    if (creationBodies.length === 1) return route.abort('failed');
    await route.fulfill({ response });
  };
  expectedRecoveryWrite = { endpoint: editorWritesEndpoint };
  await admin.route(editorWritesEndpoint, loseFirstCreationReply);
  await admin.getByRole('button', { name: '添加商品', exact: true }).click();
  const createEditor = admin.getByRole('dialog');
  await createEditor.locator('#newProduct-title').fill('Browser lost-create product');
  await createEditor.locator('#newProduct-price').fill('12.50');
  await createEditor.locator('#newProduct-stock').fill('7');
  await createEditor.locator('#newProduct-category-id').selectOption('1');
  await createEditor.getByRole('button', { name: '添加商品', exact: true }).click();
  await admin.getByRole('button', { name: '重试确认商品', exact: true }).waitFor({ state: 'visible' });
  await createEditor.waitFor({ state: 'hidden' });
  assert.match(creationBodies[0].create_key, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.equal(await admin.getByRole('button', { name: '添加商品', exact: true }).isDisabled(), true);
  await admin.reload();
  await admin.getByRole('button', { name: '重试确认商品', exact: true }).waitFor({ state: 'visible' });
  assert.equal(creationBodies.length, 1, 'reload does not automatically POST');
  await admin.getByRole('button', { name: '重试确认商品', exact: true }).click();
  await admin.waitForFunction(() => document.querySelectorAll('button').length && Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '添加商品' && !button.disabled));
  assert.equal(creationBodies.length, 2); assert.deepEqual(creationBodies[1], creationBodies[0]);
  assert.equal(creationIds[1], creationIds[0]);
  const createdRows = await (await adminContext.request.get(editorWritesEndpoint, { params: { keyword: 'Browser lost-create product' } })).json();
  assert.equal(createdRows.pagination.total, 1);
  assert.equal(createdRows.products[0].product_id, creationIds[0]); assert.equal(createdRows.products[0].stock, 7);
  const publicCreatedResponse = await fetch(`http://127.0.0.1:3101/api/products/${creationIds[0]}`);
  assert.equal(publicCreatedResponse.status, 200);
  const publicCreatedProduct = (await publicCreatedResponse.json()).product;
  for (const column of ['created_by_admin_id', 'create_key', 'create_fingerprint']) assert.equal(Object.hasOwn(publicCreatedProduct, column), false);
  assert.equal(publicCreatedProduct.title, 'Browser lost-create product'); assert.equal(publicCreatedProduct.stock, 7);
  await admin.unroute(editorWritesEndpoint, loseFirstCreationReply); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost product creation reply survives reload and retry creates one real MySQL product');
  console.log('PASS anonymous product details exclude internal creation receipts');
  const adminCouponsEndpoint = 'http://127.0.0.1:3101/api/admin/coupons';
  let adminCouponAttempts = 0;
  const adminCouponFault = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    adminCouponAttempts++;
    if (adminCouponAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '获取优惠券列表失败' }) });
    await route.continue();
  };
  expectedReadFailure = { endpoint: adminCouponsEndpoint, prefix: '获取优惠券列表失败:' };
  await admin.route(`${adminCouponsEndpoint}*`, adminCouponFault);
  await admin.goto('http://127.0.0.1:3100/admin/coupons');
  await admin.getByRole('alert').getByText('获取优惠券列表失败', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await admin.getByText('暂无优惠券', { exact: true }).count(), 0);
  await admin.getByRole('button', { name: '重新加载', exact: true }).click();
  await admin.getByRole('table').waitFor({ state: 'visible' });
  await visibleText(admin, '共 51 张优惠券');
  assert.equal(adminCouponAttempts, 2);
  await admin.unroute(`${adminCouponsEndpoint}*`, adminCouponFault); expectedReadFailure = undefined;
  await admin.getByRole('button', { name: '下一页', exact: true }).click();
  const claimedRow = admin.getByRole('row').filter({ hasText: '浏览器优惠券1' });
  await claimedRow.waitFor({ state: 'visible' });
  await claimedRow.getByText('已领: 1', { exact: true }).waitFor({ state: 'visible' });
  await claimedRow.getByText('已用: 0', { exact: true }).waitFor({ state: 'visible' });
  await claimedRow.getByRole('button', { name: '禁用', exact: true }).click();
  await visibleText(admin, '状态更新成功！');
  await admin.getByRole('combobox', { name: '优惠券状态', exact: true }).selectOption('0');
  await admin.getByText('浏览器优惠券1', { exact: true }).waitFor({ state: 'visible' });
  await visibleText(admin, '共 1 张优惠券');
  console.log('PASS browser admin coupon retry, real receipt counts, pagination and disabled-status filtering');
  await admin.goto('http://127.0.0.1:3100/admin/orders');
  const shipmentRow = admin.getByRole('row').filter({ hasText: realOrderNo });
  await shipmentRow.getByRole('button', { name: '发货', exact: true }).click();
  await admin.getByLabel('快递公司').fill('测试快递');
  await admin.getByLabel('运单号').fill('E2E-TRACK-123');
  const shipmentEndpoint = `http://127.0.0.1:3101/api/admin/orders/${orderUrl.split('/').pop()}/status`;
  let shipmentWrites = 0;
  const lostShipmentReply = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    shipmentWrites++;
    const response = await route.fetch(); assert.equal(response.status(), 200);
    return route.abort('failed');
  };
  expectedRecoveryWrite = { endpoint: shipmentEndpoint }; await admin.route(shipmentEndpoint, lostShipmentReply);
  await admin.getByRole('button', { name: '确认发货', exact: true }).click();
  await shipmentRow.getByText('已发货', { exact: true }).waitFor({ state: 'visible' });
  await shipmentRow.getByText('E2E-TRACK-123', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(shipmentWrites, 1);
  assert.equal(await admin.getByRole('button', { name: '确认发货', exact: true }).count(), 0);
  await admin.unroute(shipmentEndpoint, lostShipmentReply); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost shipment reply reads actual shipped state without repeating PUT');
  await page.goto(orderUrl);
  await visibleText(page, 'E2E-TRACK-123');
  await page.getByRole('button', { name: '确认收货', exact: true }).click();
  await visibleText(page, '已完成');
  console.log('PASS browser admin shipment and customer receipt');
  await page.getByRole('combobox', { name: /^评分/ }).selectOption('3');
  await page.getByLabel('评价内容（可选）', { exact: true }).fill('Browser verified purchase review');
  const purchaseReviewEndpoint = 'http://127.0.0.1:3101/api/reviews';
  let purchaseReviewWrites = 0;
  const loseReviewReply = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    purchaseReviewWrites++;
    const response = await route.fetch(); assert.equal(response.status(), 201);
    await route.abort('failed');
  };
  expectedRecoveryWrite = { endpoint: purchaseReviewEndpoint };
  await page.route(purchaseReviewEndpoint, loseReviewReply);
  await page.getByRole('button', { name: '提交评价', exact: true }).click();
  await visibleText(page, '已评价');
  assert.equal(purchaseReviewWrites, 1);
  await page.unroute(purchaseReviewEndpoint, loseReviewReply); expectedRecoveryWrite = undefined;
  console.log('PASS browser committed review with a lost reply restores saved status without another POST');
  const rated = await context.request.get('http://127.0.0.1:3101/api/products/1');
  const ratedProduct = (await rated.json()).product;
  assert.equal(Number(ratedProduct.rating), 3);
  assert.equal(Number(ratedProduct.review_count), 1);
  assert.equal(Number(ratedProduct.stock), 19);
  await page.goto('http://127.0.0.1:3100/products/1');
  await visibleText(page, 'Browser verified purchase review');
  await visibleText(page, '共 1 条评价');
  await page.goto(orderUrl);
  console.log('PASS browser saved purchase review updates actual product score without changing stock');
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
  await page.getByLabel('申请类型').selectOption('return');
  await page.getByLabel('申请原因').fill('仅浏览器测试的售后原因');
  const afterSalesWriteEndpoint = `http://127.0.0.1:3101/api/orders/${orderUrl.split('/').pop()}/after-sales`;
  let afterSalesWrites = 0;
  const lostApplication = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    afterSalesWrites++; const response = await route.fetch(); assert.equal(response.status(), 201); return route.abort('failed');
  };
  expectedRecoveryWrite = { endpoint: afterSalesWriteEndpoint }; await page.route(afterSalesWriteEndpoint, lostApplication);
  await page.getByRole('button', { name: '提交申请', exact: true }).click();
  await visibleText(page, '待审核');
  assert.equal(afterSalesWrites, 1); assert.equal(await page.getByRole('button', { name: '提交申请', exact: true }).count(), 0);
  await page.unroute(afterSalesWriteEndpoint, lostApplication); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost application response reconciles actual SQL state without repeating submission');
  await admin.goto('http://127.0.0.1:3100/admin/after-sales');
  await visibleText(admin, '仅浏览器测试的售后原因');
  await visibleText(admin, `用户：${customerUsername}`);
  await visibleText(admin, '可记录退款上限：¥0.00');
  await visibleText(admin, '演示订单，未实际扣款');
  await admin.getByRole('button', { name: '通过审核', exact: true }).first().click();
  await admin.getByLabel('审核说明').fill('仅审核通过，不产生真实退款');
  const approvalEndpoint = 'http://127.0.0.1:3101/api/admin/after-sales/*/review';
  let approvalWrites = 0;
  const lostApproval = async route => { approvalWrites++; expectedRecoveryWrite = { endpoint: route.request().url() }; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed'); };
  await admin.route(approvalEndpoint, lostApproval);
  await admin.getByRole('button', { name: '保存审核结果', exact: true }).click();
  await admin.getByText('暂无售后申请', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(approvalWrites, 1); assert.equal(await admin.getByLabel('审核说明').count(), 0);
  await admin.unroute(approvalEndpoint, lostApproval); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost admin approval response closes the obsolete review draft after canonical reload');
  await page.getByRole('button', { name: '刷新售后进度', exact: true }).click();
  await visibleText(page, '审核通过');
  await visibleText(page, '不会自动退款');
  console.log('PASS browser after-sales request and admin approval without refund');
  await page.getByLabel('退货快递公司').fill('Browser return carrier');
  await page.getByLabel('退货运单号').fill('RETURN-BROWSER-001');
  const trackingEndpoint = `${afterSalesWriteEndpoint}/return-tracking`;
  let trackingWrites = 0;
  const lostTracking = async route => { trackingWrites++; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed'); };
  expectedRecoveryWrite = { endpoint: trackingEndpoint }; await page.route(trackingEndpoint, lostTracking);
  await page.getByRole('button', { name: '提交退货运单', exact: true }).click();
  await visibleText(page, '已寄回，待处理');
  assert.equal(trackingWrites, 1); assert.equal(await page.getByLabel('退货运单号').count(), 0);
  await page.unroute(trackingEndpoint, lostTracking); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost tracking response recovers committed parcel without repeating write');
  await visibleText(page, 'RETURN-BROWSER-001');
  console.log('PASS browser customer return tracking and processing progress');
  await admin.getByLabel('审核状态').selectOption('approved');
  await visibleText(admin, 'RETURN-BROWSER-001');
  await admin.getByRole('button', { name: '记录处理并结案', exact: true }).click();
  const closureForm = admin.locator('form').filter({ has: admin.getByLabel('实际退款金额') });
  await closureForm.getByText('可记录退款上限：¥0.00', { exact: true }).waitFor({ state: 'visible' });
  await admin.getByLabel('实际退款金额').fill('0.00');
  await admin.getByLabel('结案说明').fill('演示订单未实际付款，仅记录人工处理完成');
  const closureEndpoint = 'http://127.0.0.1:3101/api/admin/after-sales/*/complete';
  let closureWrites = 0;
  const lostClosure = async route => { closureWrites++; expectedRecoveryWrite = { endpoint: route.request().url() }; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed'); };
  await admin.route(closureEndpoint, lostClosure);
  await admin.getByRole('button', { name: '保存结案记录', exact: true }).click();
  await visibleText(admin, '已结案');
  assert.equal(closureWrites, 1); assert.equal(await admin.getByLabel('实际退款金额').count(), 0);
  await admin.unroute(closureEndpoint, lostClosure); expectedRecoveryWrite = undefined;
  console.log('PASS browser lost manual closure response recovers actual record and disables obsolete closure form');
  await page.getByRole('button', { name: '刷新售后进度', exact: true }).click();
  await visibleText(page, '已结案');
  await visibleText(page, '演示订单未实际付款，仅记录人工处理完成');
  await page.getByRole('button', { name: '提交退货运单', exact: true }).waitFor({ state: 'hidden' });
  console.log('PASS browser admin manual closure and customer closure record');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/commerce-after-sales.png'), fullPage: true });
  const capabilityEndpoint = 'http://127.0.0.1:3101/api/users/password/capabilities';
  let capabilityUnavailable = true, capabilityAttempts = 0;
  const capabilityFault = route => { capabilityAttempts++; return capabilityUnavailable
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic unavailable' }) }) : route.continue(); };
  expectedReadFailure = { endpoint: capabilityEndpoint };
  await page.route(capabilityEndpoint, capabilityFault);
  await page.goto('http://127.0.0.1:3100/forgot-password');
  await visibleText(page, '加载邮件服务状态失败，请重试');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill(customerEmail);
  const beforeCapabilityRetry = capabilityAttempts; capabilityUnavailable = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await visibleText(page, '密码找回邮件服务暂不可用');
  assert.equal(capabilityAttempts, beforeCapabilityRetry + 1);
  assert.equal(await page.getByRole('textbox', { name: '邮箱', exact: true }).inputValue(), customerEmail);
  assert.equal(await page.getByRole('button', { name: '发送重置邮件', exact: true }).isDisabled(), true);
  await page.unroute(capabilityEndpoint, capabilityFault); expectedReadFailure = undefined;
  console.log('PASS browser password capability retry preserves email and distinguishes the real disabled service');
  await page.goto('http://127.0.0.1:3100/profile/settings');
  const profileEndpoint = 'http://127.0.0.1:3101/api/users/profile';
  const updatedUsername = `${customerUsername}updated`;
  let profileWrites = 0;
  const lostProfile = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    profileWrites++; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed');
  };
  expectedRecoveryWrite = { endpoint: profileEndpoint }; await page.route(profileEndpoint, lostProfile);
  await page.getByRole('textbox', { name: '用户名', exact: true }).fill(updatedUsername);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await visibleText(page, '资料已保存');
  assert.equal(profileWrites, 1); assert.equal(await page.getByRole('button', { name: '撤销修改', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('textbox', { name: '用户名', exact: true }).inputValue(), updatedUsername);
  await page.unroute(profileEndpoint, lostProfile); expectedRecoveryWrite = undefined;
  await page.reload();
  assert.equal(await page.getByRole('textbox', { name: '用户名', exact: true }).inputValue(), updatedUsername);
  console.log('PASS browser lost profile save response synchronizes canonical username and survives reload');
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
  await page.goto('http://127.0.0.1:3100/profile/settings');
  const passwordEndpoint = 'http://127.0.0.1:3101/api/users/password';
  let passwordWrites = 0;
  const lostPasswordReply = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    passwordWrites++;
    const response = await route.fetch(); assert.equal(response.status(), 200);
    assert.equal((await response.json()).reauthenticate, true);
    return route.abort('failed');
  };
  await page.getByLabel('当前密码', { exact: true }).fill('BrowserUpdated456!');
  await page.getByLabel('新密码', { exact: true }).fill('BrowserRecovered789!');
  await page.getByLabel('确认新密码', { exact: true }).fill('BrowserRecovered789!');
  expectedRecoveryWrite = { endpoint: passwordEndpoint }; await page.route(passwordEndpoint, lostPasswordReply);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.waitForURL(/\/login\?passwordChangeUnconfirmed=1$/);
  await visibleText(page, '修改密码结果尚未确认，请先尝试用新密码登录；若无法登录，请使用密码找回');
  assert.equal(await page.locator('input[type="password"]').inputValue(), '');
  assert.equal(passwordWrites, 1);
  const endedPasswordSession = await context.request.get('http://127.0.0.1:3101/api/users/profile');
  assert.equal(endedPasswordSession.status(), 401);
  await page.unroute(passwordEndpoint, lostPasswordReply); expectedRecoveryWrite = undefined;
  await page.locator('input[type="email"]').fill(customerEmail);
  await page.locator('input[type="password"]').fill('BrowserUpdated456!');
  expectedLoginFailure = true;
  const rejectedOldPassword = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === 'http://127.0.0.1:3101/api/users/login');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  assert.equal((await rejectedOldPassword).status(), 401); await visibleText(page, '邮箱或密码错误');
  expectedLoginFailure = false;
  await page.locator('input[type="password"]').fill('BrowserRecovered789!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  assert.equal(passwordWrites, 1);
  console.log('PASS browser committed password change with lost reply clears inputs and recovers by signing in');
  await require('./customer-order-recovery.cjs')({ page, context, adminContext,
    setExpectedWrite: value => { expectedRecoveryWrite = value; }, setExpectedRead: value => { expectedReadFailure = value; } });
  await require('./admin-inventory-recovery.cjs')({ admin, context, adminContext,
    setExpectedWrite: value => { expectedRecoveryWrite = value; } });
  await require('./customer-auth-lifecycle.cjs')({ browser, localPlatformScripts, watchConsole, customerEmail, errors });
  await require('./queued-password-account.cjs')({ browser, localPlatformScripts, watchConsole, errors });
  await require('./admin-user-management.cjs')({ admin, context, adminContext, customerEmail,
    setExpectedWrite: value => { expectedRecoveryWrite = value; }, setExpectedRead: value => { expectedReadFailure = value; } });
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
