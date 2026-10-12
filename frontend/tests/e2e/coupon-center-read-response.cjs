const assert = require('node:assert/strict');

/** An absent page envelope stays an error instead of reporting no claimable coupons. */
module.exports = async function couponCenterReadResponse({ browser, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const endpoint = `${api}/coupons/available`, headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `couponread${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserCouponRead123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const response = await context.request.get(`${endpoint}?page=1&page_size=50`); assert.equal(response.status(), 200);
    const actual = await response.json();
    const allocated = actual.data.find(coupon => coupon.coupon_id !== 1 && coupon.remain_quantity > 0);
    assert.ok(allocated, 'the local SQL fixture has a coupon with a spare allocation');
    const receiptsBefore = await context.request.get(`${api}/coupons/my/list`); assert.equal(receiptsBefore.status(), 200);
    assert.deepEqual((await receiptsBefore.json()).data, []);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'coupon-center-read-response');
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
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.continue();
    setExpectedRead({ endpoint }); await context.route(matches, invalidRead);
    await page.goto(`${origin}/coupons`);
    const alert = page.locator('main').getByRole('alert');
    await alert.getByText('加载优惠券失败，请重试', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText('暂无可领取的优惠券', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '立即领取', exact: true }).count(), 0);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await alert.getByText('Unable to load coupons. Please try again.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(reads, 1); assert.deepEqual(writes, []);
    await context.unroute(matches, invalidRead);
    const retryResponse = page.waitForResponse(result => result.request().method() === 'GET' && result.url().split('?')[0] === endpoint);
    await alert.getByRole('button', { name: 'Reload coupons', exact: true }).click();
    const restored = await retryResponse; assert.equal(restored.status(), 200);
    assert.deepEqual(Object.fromEntries(new URL(restored.url()).searchParams), { page: '1', page_size: '50' });
    assert.deepEqual(await restored.json(), actual);
    await alert.waitFor({ state: 'detached' });
    const card = page.getByRole('heading', { name: allocated.name, exact: true }).locator('..');
    await card.getByRole('button', { name: 'Claim now', exact: true }).click({ trial: true });
    assert.equal(reads, 2, 'explicit retry makes one fresh available-coupon read');
    assert.deepEqual((await page.locator('main h3').allTextContents()).map(name => name.trim()), actual.data.map(coupon => coupon.name));
    assert.equal(await page.getByText('No coupons available to claim', { exact: true }).count(), 0);
    assert.deepEqual(writes, [], 'reloading an available page does not claim a coupon');
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('pending-coupon-claim:'))), false);
    const after = await context.request.get(`${endpoint}?page=1&page_size=50`); assert.deepEqual(await after.json(), actual);
    const receiptsAfter = await context.request.get(`${api}/coupons/my/list`); assert.deepEqual((await receiptsAfter.json()).data, []);
    console.log('PASS browser coupon center empty envelope shows bilingual error; explicit real SQL retry restores allocated claimable coupons without claims');
  } finally { setExpectedRead(undefined); await context.close(); }
};
