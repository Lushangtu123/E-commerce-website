const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** A null statistics body must leave a retryable profile with unknown counters. */
module.exports = async function profileStatsReadResponse({ browser, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const endpoint = `${api}/users/stats`, headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `statsread${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserStatsRead123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    assert.equal((await context.request.post(`${api}/favorites`, { headers, data: { product_id: 1 } })).status(), 200);
    const availableResponse = await context.request.get(`${api}/coupons/available?page=1&page_size=50`); assert.equal(availableResponse.status(), 200);
    const available = (await availableResponse.json()).data.find(coupon => coupon.coupon_id !== 1 && coupon.remain_quantity > 0);
    assert.ok(available, 'a fixture coupon retains a spare SQL allocation');
    const receipt = await context.request.post(`${api}/coupons/receive`, { headers, data: { coupon_id: available.coupon_id, claim_key: randomUUID() } });
    assert.equal(receipt.status(), 200);
    const before = await context.request.get(endpoint); assert.equal(before.status(), 200);
    const actual = await before.json();
    assert.deepEqual(actual.stats, { totalOrders: 0, pendingOrders: 0, totalCoupons: 1, availableCoupons: 1, favoriteCount: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'profile-stats-read-response');
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`); await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    const writes = []; let reads = 0;
    page.on('request', request => {
      if (request.url().startsWith(api + '/') && !['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      if (request.method() === 'GET' && request.url().split('?')[0] === endpoint) reads++;
    });
    const matches = url => url.origin + url.pathname === endpoint;
    const invalidRead = route => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }) : route.continue();
    setExpectedRead({ endpoint, prefix: '加载统计数据失败:' }); await context.route(matches, invalidRead);
    await page.goto(`${origin}/profile`);
    const alert = page.locator('main').getByRole('alert');
    await alert.getByText('统计数据加载失败，请重试', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: username, exact: true }).waitFor({ state: 'visible' });
    const counters = page.locator('main .grid.grid-cols-4');
    assert.deepEqual(await counters.locator('.text-3xl').allTextContents(), ['—', '—', '—', '—']);
    assert.equal(await page.getByText('加载中...', { exact: true }).count(), 0, 'the invalid result exits profile loading');
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await alert.getByText('Could not load account statistics. Please try again', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(reads, 1); assert.deepEqual(writes, []);
    await context.unroute(matches, invalidRead);
    const retryResponse = page.waitForResponse(response => response.request().method() === 'GET' && response.url() === endpoint);
    await alert.getByRole('button', { name: 'Reload statistics', exact: true }).click();
    const restored = await retryResponse; assert.equal(restored.status(), 200); assert.deepEqual(await restored.json(), actual);
    await alert.waitFor({ state: 'detached' });
    await counters.getByText('1', { exact: true }).first().waitFor({ state: 'visible' });
    assert.deepEqual(await counters.locator('.text-3xl').allTextContents(), ['0', '1', '1', '0']);
    assert.equal(reads, 2, 'explicit retry makes one fresh statistics read');
    assert.deepEqual(writes, [], 'retrying statistics neither creates an order nor claims another coupon');
    assert.deepEqual(await (await context.request.get(endpoint)).json(), actual);
    console.log('PASS browser null profile statistics exits loading with bilingual retry and unknown counters; real SQL retry restores coupon and favorite counts without writes');
  } finally { setExpectedRead(undefined); await context.close(); }
};
