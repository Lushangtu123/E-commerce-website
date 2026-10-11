const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Real customer cookies and SQL receipts; business requests are observed without route fixtures. */
module.exports = async function myCouponPagination({ browser, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const endpoint = `${api}/coupons/my/list`;
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `mypage${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserCouponPages123!' };
    assert.equal((await context.request.post(`${api}/users/register`, { headers, data: account })).status(), 201);
    const availableResponse = await context.request.get(`${api}/coupons/available?page=1&page_size=100`);
    assert.equal(availableResponse.status(), 200);
    // Coupon one belongs to the primary commerce flow; the other fixture coupons have spare allocations.
    const available = (await availableResponse.json()).data.filter(coupon => coupon.coupon_id !== 1).slice(0, 21);
    assert.equal(available.length, 21, 'local SQL provides 21 independently claimable coupons');
    const claimedIds = [];
    for (const coupon of available) {
      const response = await context.request.post(`${api}/coupons/receive`, {
        headers, data: { coupon_id: coupon.coupon_id, claim_key: randomUUID() },
      });
      assert.equal(response.status(), 200);
      const claimed = await response.json();
      assert.equal(claimed.success, true);
      assert.ok(Number.isSafeInteger(claimed.data.user_coupon_id) && claimed.data.user_coupon_id > 0);
      claimedIds.push(claimed.data.user_coupon_id);
    }
    const legacyResponse = await context.request.get(endpoint);
    assert.equal(legacyResponse.status(), 200);
    const legacy = await legacyResponse.json();
    assert.equal(legacy.data.length, 21, 'omitting page preserves the full receipt list');
    assert.equal(legacy.pagination, undefined);
    assert.deepEqual(legacy.data.map(coupon => coupon.user_coupon_id).sort((a, b) => a - b), [...claimedIds].sort((a, b) => a - b));
    assert.ok(legacy.data.every(coupon => coupon.status === 1));
    assert.equal((await context.request.post(`${api}/cart`, {
      headers, data: { product_id: 1, quantity: 1, add_key: randomUUID() },
    })).status(), 200);
    console.log('PASS browser isolated customer claims 21 real SQL receipts and unpaged reads retain the full list');

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'my-coupon-pagination');
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    assert.ok(await page.evaluate(() => localStorage.getItem('session')), 'UI login publishes the cookie session to browser storage');

    const reads = [], unexpectedWrites = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.origin + url.pathname === endpoint) reads.push(Object.fromEntries(url.searchParams));
      if (!['GET', 'OPTIONS'].includes(request.method()) && url.pathname.startsWith('/api/') &&
          !(request.method() === 'POST' && url.origin + url.pathname === `${api}/orders/preview`)) {
        unexpectedWrites.push(`${request.method()} ${url.pathname}`);
      }
    });
    const waitForResponse = () => page.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === endpoint);
    const assertResponse = async (response, status, number) => {
      assert.equal(response.status(), 200);
      assert.deepEqual(Object.fromEntries(new URL(response.url()).searchParams), { status: String(status), page: String(number), page_size: '20' });
      const result = await response.json();
      assert.equal(result.success, true);
      assert.deepEqual(result.pagination, { page: number, page_size: 20, total: status === 1 ? 21 : 0, total_pages: status === 1 ? 2 : 0 });
      const expected = status === 1 ? legacy.data.slice((number - 1) * 20, number * 20) : [];
      assert.deepEqual(result.data.map(coupon => coupon.user_coupon_id), expected.map(coupon => coupon.user_coupon_id));
      assert.ok(result.data.every(coupon => coupon.status === status));
      return expected;
    };
    const waitForCoupons = async coupons => {
      const names = coupons.map(coupon => coupon.name);
      await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('main h3')).map(node => node.textContent.trim())) === JSON.stringify(expected), names);
      assert.deepEqual((await page.locator('main h3').allTextContents()).map(name => name.trim()), names);
    };
    const pager = () => page.getByRole('navigation', { name: /^(优惠券分页|Coupon pagination)$/ });
    const changePage = async (name, status, number) => {
      const response = waitForResponse();
      await page.getByRole('button', { name, exact: true }).click();
      const coupons = await assertResponse(await response, status, number);
      await waitForCoupons(coupons);
      return coupons;
    };
    const firstResponse = waitForResponse();
    await page.goto(`${origin}/my/coupons`);
    const first = await assertResponse(await firstResponse, 1, 1);
    await waitForCoupons(first);
    assert.equal(await page.getByRole('button', { name: '立即使用', exact: true }).count(), 20);
    await pager().getByText('第 1 页 / 共 2 页', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await pager().getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    console.log('PASS browser my coupons first UI read requests page=1/page_size=20 and renders only 20 of 21 SQL receipts');

    const beforeEnglish = reads.length;
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('heading', { name: 'My coupons', exact: true }).waitFor({ state: 'visible' });
    await pager().getByText('Page 1 of 2', { exact: true }).waitFor({ state: 'visible' });
    await waitForCoupons(first);
    assert.equal(await page.getByRole('button', { name: 'Use now', exact: true }).count(), 20);
    assert.equal(reads.length, beforeEnglish, 'language changes reuse the displayed page');
    const second = await changePage('Next', 1, 2);
    assert.equal(second.length, 1);
    assert.equal(await page.getByRole('button', { name: 'Use now', exact: true }).count(), 1);
    await pager().getByText('Page 2 of 2', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await pager().getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
    assert.ok(first.every(coupon => coupon.user_coupon_id !== second[0].user_coupon_id), 'the final receipt is absent from page one');
    const beforePageTwoLanguage = reads.length;
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
    await pager().getByText('第 2 页 / 共 2 页', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await pager().getByText('Page 2 of 2', { exact: true }).waitFor({ state: 'visible' });
    await waitForCoupons(second);
    assert.equal(reads.length, beforePageTwoLanguage, 'both language changes retain page two without reading again');
    console.log('PASS browser English changes no coupon reads and page two renders the one remaining SQL receipt');

    await changePage('Used', 2, 1);
    await page.getByText('No used coupons', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Used', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await pager().count(), 0);
    await changePage('Expired', 3, 1);
    await page.getByText('No expired coupons', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Expired', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await pager().count(), 0);
    await changePage('Unused', 1, 1);
    await pager().getByText('Page 1 of 2', { exact: true }).waitFor({ state: 'visible' });
    await changePage('Next', 1, 2);
    await changePage('Previous', 1, 1);
    await changePage('Next', 1, 2);
    await pager().getByText('Page 2 of 2', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(reads, [[1, 1], [1, 2], [2, 1], [3, 1], [1, 1], [1, 2], [1, 1], [1, 2]].map(([status, number]) => ({ status: String(status), page: String(number), page_size: '20' })));
    console.log('PASS browser status tabs reset page two to page one and later navigation retains status and page_size');

    const selected = second[0];
    assert.notEqual(selected.user_coupon_id, selected.coupon_id, 'the receipt ID differs from the template coupon ID');
    const selectedPreview = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${api}/orders/preview` &&
      response.request().postDataJSON().user_coupon_id === selected.user_coupon_id);
    await page.getByRole('button', { name: 'Use now', exact: true }).click();
    await page.waitForURL(`${origin}/cart?user_coupon_id=${selected.user_coupon_id}`);
    const previewResponse = await selectedPreview;
    assert.equal(previewResponse.status(), 200);
    const preview = await previewResponse.json();
    assert.equal(preview.coupon.user_coupon_id, selected.user_coupon_id);
    assert.equal(preview.coupon.code, selected.code);
    await page.waitForFunction(id => document.querySelector('#checkout-coupon')?.value === id && !document.querySelector('#checkout-coupon').disabled, String(selected.user_coupon_id));
    assert.equal(await page.getByLabel('Coupons', { exact: true }).inputValue(), String(selected.user_coupon_id));
    assert.deepEqual(unexpectedWrites, [], 'pagination and coupon handoff never claim another coupon or create an order');
    const afterPreview = await context.request.get(endpoint);
    assert.equal(afterPreview.status(), 200);
    assert.deepEqual((await afterPreview.json()).data.map(coupon => [coupon.user_coupon_id, coupon.status]), legacy.data.map(coupon => [coupon.user_coupon_id, 1]));
    console.log('PASS browser second-page Use now carries the precise user_coupon_id into cart selection and real SQL preview without consuming it');
  } finally { await context.close(); }
};
