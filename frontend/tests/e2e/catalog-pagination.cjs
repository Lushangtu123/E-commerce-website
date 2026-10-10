const assert = require('node:assert/strict');

/** Real isolated SQL fixtures and Next navigation, including server HTML before hydration. */
module.exports = async function catalogPagination({ browser, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const filters = { keyword: 'PaginationFixture', brand: 'PaginationFixture', category_id: '9000', min_price: '0', max_price: '180', sort: 'price ASC' };
  const firstUrl = `${origin}/products?${new URLSearchParams(filters)}`;
  const secondUrl = `${firstUrl}&page=2`;
  const context = await browser.newContext();
  const serverContext = await browser.newContext({ javaScriptEnabled: false });
  try {
    await localPlatformScripts(context); await localPlatformScripts(serverContext);
    const expected = async (page, search = filters) => {
      const response = await context.request.get(`${api}/products?${new URLSearchParams({ ...search, page: String(page), limit: '20' })}`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const first = await expected(1), second = await expected(2);
    assert.equal(first.products.length, 20, 'fixture provides a full first page');
    assert.equal(second.products.length, 1, 'fixture provides a distinct later page');
    assert.equal(second.page, 2);
    const titles = result => result.products.map(product => product.title);
    const waitForProducts = async (page, names) => {
      await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('h3')).map(node => node.textContent.trim())) === JSON.stringify(expected), names);
      assert.deepEqual(await page.locator('h3').allTextContents().then(values => values.map(value => value.trim())), names);
    };
    const serverPage = await serverContext.newPage();
    serverPage.setDefaultTimeout(30000);
    await serverPage.goto(secondUrl);
    await waitForProducts(serverPage, titles(second));
    assert.equal(new URL(serverPage.url()).searchParams.get('page'), '2');
    console.log('PASS browser catalog shared page two is present in server HTML with JavaScript disabled');
    assert.equal(await serverPage.locator(`a[href="/products/${second.products[0].product_id}"] button`).isDisabled(), true);
    console.log('PASS browser server-rendered product card is disabled before JavaScript hydration');
    for (const selector of ['#product-sort', '#catalog-category', '#catalog-brand', '#catalog-min_price', '#catalog-max_price']) {
      assert.equal(await serverPage.locator(selector).isDisabled(), true);
    }
    assert.equal(await serverPage.locator('button').filter({ hasText: '下一页' }).isDisabled(), true);
    console.log('PASS browser server-rendered catalog controls are disabled before JavaScript hydration');

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'catalog-pagination');
    const mutations = [];
    page.on('request', request => {
      if (!['GET', 'OPTIONS'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.goto(firstUrl); await waitForProducts(page, titles(first));
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/products' && url.searchParams.get('page') === '2');
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), { ...filters, page: '2' });
    await waitForProducts(page, titles(second));
    await page.reload(); await waitForProducts(page, titles(second));
    assert.equal(new URL(page.url()).searchParams.get('page'), '2');
    console.log('PASS browser catalog page selection preserves filters and survives refresh');

    await page.goBack();
    await page.waitForURL(url => url.pathname === '/products' && !url.searchParams.has('page'));
    await waitForProducts(page, titles(first));
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get('page') === '2');
    await waitForProducts(page, titles(second));
    await page.goto(secondUrl); await waitForProducts(page, titles(second));
    console.log('PASS browser catalog direct page links and back/forward restore the matching products');

    await page.getByLabel('排序:', { exact: true }).selectOption('price DESC');
    await page.waitForURL(url => url.searchParams.get('sort') === 'price DESC' && !url.searchParams.has('page'));
    const sortedFilters = { ...filters, sort: 'price DESC' };
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), sortedFilters);
    await waitForProducts(page, titles(await expected(1, sortedFilters)));
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('page') === '2');
    await waitForProducts(page, titles(await expected(2, sortedFilters)));
    await page.getByLabel('最低价（元）', { exact: true }).fill('12');
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('min_price') === '12' && !url.searchParams.has('page'));
    const applied = { ...sortedFilters, min_price: '12' };
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), applied);
    await waitForProducts(page, titles(await expected(1, applied)));
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('page') === '2');
    await waitForProducts(page, titles(await expected(2, applied)));
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has('brand') && !url.searchParams.has('page'));
    const reset = { keyword: filters.keyword, sort: 'price DESC' };
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), reset);
    await waitForProducts(page, titles(await expected(1, reset)));
    assert.deepEqual(mutations, [], 'catalog navigation performs reads only');
    console.log('PASS browser catalog sorting, applying filters and resetting filters each return to a clean page one');
  } finally { await context.close(); await serverContext.close(); }
};
