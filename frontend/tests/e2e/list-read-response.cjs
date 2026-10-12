const assert = require('node:assert/strict');

/** Malformed successful list reads cannot masquerade as empty data or enable row writes. */
module.exports = async function listReadResponse({ browser, admin, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const context = await browser.newContext();
  let writes = [], reads = 0;
  const record = request => {
    if (!request.url().startsWith(api + '/')) return;
    if (!['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  const catalog = await context.newPage();
  catalog.setDefaultTimeout(30000);
  catalog.on('pageerror', error => errors.push(error.message)); watchConsole(catalog, 'list-read-response');
  catalog.on('request', record); admin.on('request', record);
  try {
    await localPlatformScripts(context);
    for (const [page, path, endpointPath, collection, englishError, prefix] of [
      [catalog, '/products', '/products', 'products', 'Unable to load products', '加载商品失败:'],
      [admin, '/admin/orders', '/admin/orders', 'orders', 'Failed to load orders', undefined],
      [admin, '/admin/products', '/admin/products', 'products', 'Failed to load products', '获取商品列表失败:'],
      [admin, '/admin/users', '/admin/users', 'users', 'Failed to load users', '获取用户列表失败:'],
      [admin, '/admin/coupons', '/admin/coupons', 'data', 'Unable to load coupons', '获取优惠券列表失败:'],
    ]) {
      writes = []; reads = 0;
      const endpoint = api + endpointPath;
      const matches = url => url.origin + url.pathname === endpoint;
      const invalid = route => {
        if (route.request().method() !== 'GET') return route.continue();
        reads++;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      };
      const onRead = request => { if (request.method() === 'GET' && request.url().split('?')[0] === endpoint) reads++; };
      setExpectedRead({ endpoint, prefix });
      await page.route(matches, invalid);
      await page.goto(origin + path);
      const language = page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ });
      await language.selectOption('zh-CN');
      const alert = page.locator('main').getByRole(page === catalog ? 'status' : 'alert');
      await alert.waitFor({ state: 'visible' });
      assert.equal(await page.locator('main table').count(), 0);
      if (page === catalog) {
        assert.equal(await page.getByText('暂无商品', { exact: true }).count(), 0);
        assert.ok(await page.locator('main h3').count() > 0, 'a malformed refresh preserves validated SSR products');
      }
      assert.equal(reads, 1); assert.deepEqual(writes, []);
      await language.selectOption('en');
      await alert.getByText(englishError, { exact: true }).waitFor({ state: 'visible' });
      await page.unroute(matches, invalid);
      page.on('request', onRead);
      const fresh = page.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === endpoint);
      await alert.getByRole('button', { name: 'Retry', exact: true }).click();
      const response = await fresh; assert.equal(response.status(), 200);
      const actual = await response.json(); assert.ok(actual[collection].length > 0, 'retry restores real local SQL rows');
      await alert.waitFor({ state: 'detached' });
      if (page === catalog) {
        const row = actual.products[0];
        await page.getByRole('heading', { name: row.title_en?.trim() || row.title, exact: true }).waitFor({ state: 'visible' });
      } else await page.locator('main tbody tr').first().waitFor({ state: 'visible' });
      assert.equal(reads, 2, 'one initial read and one explicit retry'); assert.deepEqual(writes, []);
      page.off('request', onRead);
      await language.selectOption('zh-CN');
      setExpectedRead(undefined);
      console.log(`PASS browser ${path} invalid 200 produces bilingual retry, preserves only validated rows and retries real SQL once without writes`);
    }
  } finally {
    setExpectedRead(undefined); admin.off('request', record); await context.close();
  }
};
