const assert = require('node:assert/strict');

/** Bad successful reads remain regional failures over real SQL-backed healthy neighbors. */
module.exports = async function homeResponse({ browser, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const regions = [
    { path: '/products/hot', query: '?limit=8', collection: 'products', chinese: '热门商品', english: 'Best sellers', message: 'Unable to load popular products. Please try again.', prefix: '加载热门商品失败，请重试', invalid: { products: {} } },
    { path: '/products', query: '?sort=created_at%20DESC&limit=8', collection: 'products', chinese: '新品推荐', english: 'New arrivals', message: 'Unable to load new arrivals. Please try again.', prefix: '加载新品失败，请重试', invalid: {} },
    { path: '/recommendations/guess-you-like', query: '?limit=8', collection: 'recommendations', chinese: '猜你喜欢', english: 'Recommended for you', message: 'Unable to load recommendations. Please try again.', prefix: '加载推荐失败，请重试', invalid: { recommendations: [null] } },
  ];
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'home-response');
    const reads = new Map(), writes = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== new URL(api).origin) return;
      if (request.method() === 'POST') writes.push(url.pathname);
      for (const region of regions) if (url.pathname === '/api' + region.path && request.method() === 'GET') reads.set(region.path, (reads.get(region.path) || 0) + 1);
    });
    for (const target of regions) {
      const response = await context.request.get(api + target.path + target.query);
      assert.equal(response.status(), 200); const valid = await response.json();
      assert.ok(valid[target.collection].length > 0);
      let broken = true;
      const matches = url => url.origin === new URL(api).origin && url.pathname === '/api' + target.path;
      const routeRead = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(broken ? target.invalid : valid) });
      setExpectedRead({ endpoint: api + target.path, prefix: target.prefix }); await page.route(matches, routeRead);
      await page.goto(origin + '/');
      await page.getByRole('heading', { name: '欢迎来到电商平台', exact: true }).waitFor({ state: 'visible' });
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: target.chinese, exact: true }) });
      await section.getByRole('alert').waitFor({ state: 'visible' });
      for (const neighbor of regions.filter(region => region !== target)) {
        await page.locator('section').filter({ has: page.getByRole('heading', { name: neighbor.chinese, exact: true }) }).locator('a[href^="/products/"]').first().waitFor({ state: 'visible' });
      }
      const before = new Map(reads);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      const translated = page.locator('section').filter({ has: page.getByRole('heading', { name: target.english, exact: true }) });
      await translated.getByRole('alert').getByText(target.message, { exact: true }).waitFor({ state: 'visible' });
      for (const region of regions) assert.equal(reads.get(region.path), before.get(region.path));
      broken = false; await translated.getByRole('button', { name: 'Retry', exact: true }).click();
      await translated.getByRole('alert').waitFor({ state: 'detached' });
      await translated.locator('a[href^="/products/"]').first().waitFor({ state: 'visible' });
      assert.equal(reads.get(target.path), before.get(target.path) + 1);
      for (const neighbor of regions.filter(region => region !== target)) assert.equal(reads.get(neighbor.path), before.get(neighbor.path));
      assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('pending-cart-add:'))), false);
      await page.unroute(matches, routeRead); setExpectedRead(undefined);
      await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
      console.log(`PASS browser home ${target.path} invalid success preserves healthy SQL-backed neighbors and bilingual one-read recovery without writes`);
    }
  } finally { setExpectedRead(undefined); await context.close(); }
};
