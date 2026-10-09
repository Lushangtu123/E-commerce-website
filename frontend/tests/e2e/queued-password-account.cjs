const assert = require('node:assert/strict');

/** Two real tabs share Web Locks, storage and HttpOnly cookies; both accounts use the same password. */
module.exports = async function queuedPasswordAccount({ browser, localPlatformScripts, watchConsole, errors }) {
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const api = 'http://127.0.0.1:3101/api';
    const password = 'SharedBrowserPassword123!';
    const suffix = Date.now();
    const accounts = ['a', 'b'].map(letter => ({ username: `queue${letter}${suffix}`, email: `queue${letter}${suffix}@example.test`, password }));
    for (const account of accounts) {
      const registered = await context.request.post(`${api}/users/register`, { data: account, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      assert.equal(registered.status(), 201);
    }
    const pageA = await context.newPage(), pageB = await context.newPage();
    for (const [page, label] of [[pageA, 'queued-password-a'], [pageB, 'queued-password-b']]) {
      page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message)); watchConsole(page, label);
    }
    const login = async (page, account) => {
      await page.goto('http://127.0.0.1:3100/login');
      await page.getByLabel('邮箱', { exact: true }).fill(account.email);
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
    };
    await login(pageA, accounts[0]); await pageA.waitForURL('http://127.0.0.1:3100/');
    await pageA.getByText(accounts[0].username, { exact: true }).waitFor({ state: 'visible' });
    await pageA.goto('http://127.0.0.1:3100/profile/settings');
    await pageA.getByLabel('当前密码', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await pageA.evaluate(() => !!navigator.locks), true, 'browser has real Web Locks');
    let releaseLogin, loginStarted, writes = 0;
    const gate = new Promise(resolve => { releaseLogin = resolve; });
    const started = new Promise(resolve => { loginStarted = resolve; });
    await pageB.route(`${api}/users/login`, async route => { loginStarted(); await gate; return route.continue(); });
    pageA.on('request', request => { if (request.method() === 'PUT' && request.url() === `${api}/users/password`) writes++; });
    await login(pageB, accounts[1]); await started;
    await pageA.getByLabel('当前密码', { exact: true }).fill(password);
    await pageA.getByLabel('新密码', { exact: true }).fill('IntendedForAccountA456!');
    await pageA.getByLabel('确认新密码', { exact: true }).fill('IntendedForAccountA456!');
    await pageA.getByRole('button', { name: '修改密码', exact: true }).click();
    await pageA.getByRole('button', { name: '处理中...', exact: true }).waitFor({ state: 'visible' });
    assert.equal(writes, 0, 'password change is waiting for the other tab cookie lock');
    releaseLogin(); await pageB.waitForURL('http://127.0.0.1:3100/');
    await pageB.getByText(accounts[1].username, { exact: true }).waitFor({ state: 'visible' });
    await pageA.waitForFunction(username => document.querySelector('input[name="username"]')?.value === username, accounts[1].username);
    await pageA.waitForFunction(username => JSON.parse(localStorage.getItem('user'))?.username === username, accounts[1].username);
    // Await the queued callback, rather than ending the test while it still owns/waits on the lock.
    await pageA.evaluate(() => navigator.locks.request('customer-session-cookie', () => undefined));
    assert.equal(writes, 0, 'the obsolete request never reaches the authenticated password endpoint');
    const profile = await context.request.get(`${api}/users/profile`); assert.equal(profile.status(), 200);
    assert.equal((await profile.json()).user.email, accounts[1].email);
    for (const account of accounts) {
      const control = await browser.newContext();
      try {
        const accepted = await control.request.post(`${api}/users/login`, { data: { email: account.email, password }, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        assert.equal(accepted.status(), 200, 'both original passwords remain valid');
      } finally { await control.close(); }
    }
    console.log('PASS browser real two-tab cookie lock cancels queued password for a replaced account and preserves both passwords');
  } finally { await context.close(); }
};
