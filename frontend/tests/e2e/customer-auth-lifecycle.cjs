const assert = require('node:assert/strict');

/** Real HttpOnly cookie responses, with the first login held while its page is left. */
module.exports = async function customerAuthLifecycle({ browser, localPlatformScripts, watchConsole, customerEmail, errors }) {
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'auth-lifecycle');
    const endpoint = 'http://127.0.0.1:3101/api/users/login';
    let releaseFirst, firstStarted, loginWrites = 0, registerWrites = 0;
    const gate = new Promise(resolve => { releaseFirst = resolve; });
    const started = new Promise(resolve => { firstStarted = resolve; });
    await page.route(endpoint, async route => {
      loginWrites++; firstStarted(); await gate;
      // route.continue lets the browser, rather than the test HTTP client, receive Set-Cookie.
      return route.continue();
    });
    page.on('request', request => {
      if (request.method() === 'POST' && request.url() === 'http://127.0.0.1:3101/api/users/register') registerWrites++;
    });
    await page.goto('http://127.0.0.1:3100/login');
    await page.getByLabel('邮箱', { exact: true }).fill(customerEmail);
    await page.getByLabel('密码', { exact: true }).fill('BrowserRecovered789!');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await started;
    await page.getByRole('link', { name: '立即注册', exact: true }).click();
    await page.waitForURL(/\/register$/);
    const username = `authorder${Date.now()}`, email = `${username}@example.test`;
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill('BrowserAuthOrder123!');
    await page.getByLabel('确认密码', { exact: true }).fill('BrowserAuthOrder123!');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByRole('button', { name: '注册中...', exact: true }).waitFor({ state: 'visible' });
    assert.equal(registerWrites, 0, 'next cookie writer waits for the pending first login');
    releaseFirst();
    await page.waitForURL('http://127.0.0.1:3100/');
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(loginWrites, 1); assert.equal(registerWrites, 1);
    const displayed = await page.evaluate(() => JSON.parse(localStorage.getItem('user')));
    const profile = await context.request.get('http://127.0.0.1:3101/api/users/profile');
    assert.equal(profile.status(), 200);
    assert.equal((await profile.json()).user.email, email);
    assert.equal(displayed.email, email);
    await page.reload(); await page.getByText(username, { exact: true }).waitFor({ state: 'visible' });
    assert.equal((await (await context.request.get('http://127.0.0.1:3101/api/users/profile')).json()).user.email, email);
    console.log('PASS browser late abandoned login cannot overwrite later registered account or its real HttpOnly cookie');
  } finally { await context.close(); }
};
