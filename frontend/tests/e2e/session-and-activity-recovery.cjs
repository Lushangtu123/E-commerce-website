const assert = require('node:assert/strict');

/** Real cookies and SQL writes, with failures injected only in browser storage or responses. */
module.exports = async function sessionAndActivityRecovery({ browser, localPlatformScripts, watchConsole, errors,
  setExpectedWrite, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const password = 'BrowserStorageRecovery123!';
  const context = await browser.newContext(), other = await browser.newContext();
  try {
    const register = async (client, username) => {
      const response = await client.request.post(`${api}/users/register`, { headers,
        data: { username, email: `${username}@example.test`, password } });
      assert.equal(response.status(), 201); return (await response.json()).user;
    };
    const first = await register(context, `storageold${Date.now()}`);
    const next = await register(other, `storagenext${Date.now()}`);
    await localPlatformScripts(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'session-activity-recovery');
    await page.goto(`${origin}/login`);
    await page.evaluate(user => {
      localStorage.setItem('session', 'browser-earlier-customer');
      localStorage.setItem('user', JSON.stringify(user));
    }, first);
    await page.reload();
    await page.getByText(first.username, { exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const save = Storage.prototype.setItem;
      window.__restoreCustomerStorage = () => { Storage.prototype.setItem = save; };
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === 'user') throw new DOMException('Fixture storage quota exhausted', 'QuotaExceededError');
        return save.call(this, key, value);
      };
    });
    await page.getByLabel('邮箱', { exact: true }).fill(next.email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('无法保存登录状态，请恢复浏览器存储后重新登录', { exact: true }).waitFor({ state: 'visible' });
    assert.equal((await context.request.get(`${api}/users/profile`)).status(), 401);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('session'), localStorage.getItem('user')]), [null, null]);
    assert.match(page.url(), /\/login$/);
    await page.evaluate(() => window.__restoreCustomerStorage());
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);
    await page.getByText(next.username, { exact: true }).waitFor({ state: 'visible' });
    const profile = await context.request.get(`${api}/users/profile`); assert.equal(profile.status(), 200);
    assert.equal((await profile.json()).user.user_id, next.user_id);
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('user')))).user_id, next.user_id);
    console.log('PASS browser partial customer storage publication clears the real cookie and retry restores matching identity');

    for (const item of [
      { page: 'favorites', add: '/favorites', list: '/favorites/my', remove: '/favorites/1', title: '取消收藏', empty: 'No favorites yet' },
      { page: 'history', add: '/browse/record', list: '/browse/history', remove: '/browse/history/1', title: '删除记录', empty: 'No browsing history yet' },
    ]) {
      await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
      assert.equal((await context.request.post(api + item.add, { headers, data: { product_id: 1 } })).status(), 200);
      let writes = 0, unavailable = false;
      const listEndpoint = api + item.list, removeEndpoint = api + item.remove;
      const failRead = route => unavailable ? route.fulfill({ status: 503, contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ message: 'Fixture list unavailable' }),
      }) : route.continue();
      const loseDelete = async route => {
        writes++; const response = await route.fetch(); assert.equal(response.status(), 200);
        unavailable = true; return route.abort('failed');
      };
      const readPattern = new RegExp(`${item.list.replaceAll('/', '\\/')}(?:\\?.*)?$`);
      setExpectedWrite({ endpoint: removeEndpoint }); setExpectedRead({ endpoint: listEndpoint });
      await page.route(readPattern, failRead); await page.route(removeEndpoint, loseDelete);
      await page.goto(`${origin}/${item.page}`);
      const remove = page.getByRole('button', { name: item.title, exact: true });
      await remove.click();
      await page.getByRole('button', { name: '重新核对列表', exact: true }).click({ trial: true });
      assert.equal(writes, 1);
      assert.equal((await (await context.request.get(listEndpoint)).json()).pagination.total, 0);
      await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
      await page.getByText('The deletion result is unconfirmed. Check the list again before continuing.', { exact: true }).waitFor({ state: 'visible' });
      unavailable = false; await page.getByRole('button', { name: 'Check list again', exact: true }).click();
      await page.getByText(item.empty, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(writes, 1, 'recovery only reads and never repeats the delete');
      await page.unroute(readPattern, failRead); await page.unroute(removeEndpoint, loseDelete);
      setExpectedWrite(undefined); setExpectedRead(undefined);
      console.log(`PASS browser ${item.page} lost delete and failed reload recover real empty SQL list by explicit bilingual read-only retry`);
    }
  } finally {
    setExpectedWrite(undefined); setExpectedRead(undefined);
    await context.close(); await other.close();
  }
};
