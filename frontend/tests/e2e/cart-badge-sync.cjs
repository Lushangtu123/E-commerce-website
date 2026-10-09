const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Real customer cookies and canonical cart; no cart page is visited before the login/reload checks. */
module.exports = async function cartBadgeSync({ browser, localPlatformScripts, watchConsole, errors, setExpectedRead }) {
  const context = await browser.newContext();
  const api = 'http://127.0.0.1:3101/api';
  const home = 'http://127.0.0.1:3100/';
  try {
    await localPlatformScripts(context);
    const suffix = Date.now();
    const account = { username: `badge${suffix}`, email: `badge${suffix}@example.test`, password: 'BrowserBadge123!' };
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    const registered = await context.request.post(`${api}/users/register`, { data: account, headers });
    assert.equal(registered.status(), 201);
    const added = await context.request.post(`${api}/cart`, { data: { product_id: 1, quantity: 3, add_key: randomUUID() }, headers });
    assert.equal(added.status(), 200);
    const canonical = await context.request.get(`${api}/cart`);
    assert.equal((await canonical.json()).items.reduce((count, item) => count + item.quantity, 0), 3);

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'cart-badge');
    let cartVisits = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/cart') cartVisits++; });
    const badge = () => page.getByRole('link', { name: '购物车', exact: true });
    const waitCount = async count => {
      await page.waitForFunction(value => document.querySelector('header a[href="/cart"]')?.textContent?.trim() === String(value), count);
      assert.equal((await badge().textContent()).trim(), String(count));
    };
    await page.goto(`${home}login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(home); await waitCount(3);
    await page.reload(); await waitCount(3);
    assert.equal(cartVisits, 0, 'the homepage restores canonical contents before any cart-page visit');
    console.log('PASS browser login and homepage reload restore canonical cart badge before visiting cart');

    const endpoint = `${api}/cart`;
    let failedReads = 0;
    const failOnce = route => {
      if (route.request().method() !== 'GET' || failedReads++) return route.continue();
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '获取购物车失败' }) });
    };
    setExpectedRead({ endpoint }); await page.route(endpoint, failOnce);
    await page.reload();
    const retry = page.getByRole('button', { name: '重新加载购物车', exact: true });
    await retry.waitFor({ state: 'visible' });
    assert.equal((await badge().textContent()).trim(), '', 'a failed read is not a confirmed zero');
    await retry.click(); await waitCount(3);
    await page.unroute(endpoint, failOnce); setExpectedRead(undefined);
    console.log('PASS browser cart badge read failure offers a read-only retry and restores canonical count');

    await page.goto(`${home}products/1`);
    await page.getByRole('button', { name: '加入购物车', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '加入购物车')?.disabled);
    await page.getByRole('button', { name: '加入购物车', exact: true }).click(); await waitCount(4);
    await page.goto(`${home}cart`);
    await page.getByRole('button', { name: '-', exact: true }).click(); await waitCount(3);
    await page.goto(home); await waitCount(3);
    console.log('PASS browser acknowledged add and decrement keep the global badge in sync');
  } finally { setExpectedRead(undefined); await context.close(); }
};
