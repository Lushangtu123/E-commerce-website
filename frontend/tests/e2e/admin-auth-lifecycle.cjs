const assert = require('node:assert/strict');

/** Real cookie revocation and re-login, in one page and in two tabs sharing Web Locks. */
module.exports = async function adminAuthLifecycle({ browser, localPlatformScripts, watchConsole, errors }) {
  const frontend = 'http://127.0.0.1:3100';
  const api = 'http://127.0.0.1:3101/api';
  for (const secondTab of [false, true]) {
    const context = await browser.newContext();
    let releaseLogout;
    try {
      await localPlatformScripts(context);
      const pageA = await context.newPage();
      const observe = (page, label) => {
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.message));
        watchConsole(page, label);
      };
      observe(pageA, `admin-auth-${secondTab ? 'tabs-a' : 'navigation'}`);
      const submitLogin = async page => {
        await page.getByLabel('用户名', { exact: true }).fill('admin');
        await page.getByLabel('密码', { exact: true }).fill('BrowserFixtureAdmin123!');
        await page.getByRole('button', { name: '登录', exact: true }).click();
      };
      await pageA.goto(`${frontend}/admin/login`); await submitLogin(pageA);
      await pageA.waitForURL(`${frontend}/admin/dashboard`);
      await pageA.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await pageA.evaluate(() => !!navigator.locks), true);

      let logoutStarted, loginWrites = 0, logoutWrites = 0;
      const gate = new Promise(resolve => { releaseLogout = resolve; });
      const started = new Promise(resolve => { logoutStarted = resolve; });
      await pageA.route(`${api}/admin/logout`, async route => {
        logoutWrites++; logoutStarted(); await gate;
        // The browser applies the genuine server Set-Cookie after the queued logout completes.
        return route.continue();
      });
      context.on('request', request => {
        if (request.method() === 'POST' && request.url() === `${api}/admin/login`) loginWrites++;
      });
      await pageA.getByRole('button', { name: '退出登录', exact: true }).click();
      await started; await pageA.waitForURL(`${frontend}/admin/login`);
      const pageB = secondTab ? await context.newPage() : pageA;
      if (secondTab) { observe(pageB, 'admin-auth-tabs-b'); await pageB.goto(`${frontend}/admin/login`); }
      await submitLogin(pageB);
      await pageB.getByRole('button', { name: '登录中...', exact: true }).waitFor({ state: 'visible' });
      assert.equal(loginWrites, 0, 'new credentials wait until the previous cookie revocation completes');
      assert.equal(logoutWrites, 1);
      releaseLogout();
      await pageB.waitForURL(`${frontend}/admin/dashboard`);
      await pageB.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
      assert.equal(loginWrites, 1);
      const profile = await context.request.get(`${api}/admin/profile`);
      assert.equal(profile.status(), 200, 'the newly issued HttpOnly cookie remains valid');
      assert.equal((await profile.json()).admin.username, 'admin');
      assert.equal(await pageB.evaluate(() => localStorage.getItem('admin_session_cleanup_pending')), null);
      await pageB.reload();
      await pageB.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'visible' });
      assert.equal((await context.request.get(`${api}/admin/profile`)).status(), 200);
      console.log(`PASS browser administrator ${secondTab ? 'two-tab Web Lock' : 'navigation'} orders logout before re-login and preserves the real session after reload`);
    } finally {
      releaseLogout?.();
      await context.close();
    }
  }
};
