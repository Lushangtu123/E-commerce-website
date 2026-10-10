const assert = require('node:assert/strict');
const http = require('node:http');

/** Uses two real administrators and a held login body in the disposable commerce fixture. */
module.exports = async function adminPublicationGuard({ browser, localPlatformScripts, watchConsole, errors }) {
  const frontend = 'http://127.0.0.1:3100';
  const api = 'http://127.0.0.1:3101/api';
  const context = await browser.newContext();
  let releaseBody, headersReady, failHeaders;
  const gate = new Promise(resolve => { releaseBody = resolve; });
  const headers = new Promise((resolve, reject) => { headersReady = resolve; failHeaders = reject; });
  // Flush genuine Set-Cookie headers before JSON; route.fetch/fulfill cannot model this ordering.
  const relay = http.createServer((request, response) => {
    if (request.url !== '/api/admin/login' || !['POST', 'OPTIONS'].includes(request.method)) {
      response.writeHead(404).end(); return;
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: 3101, path: request.url, method: request.method,
      headers: { ...request.headers, host: '127.0.0.1:3101' } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); response.flushHeaders();
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('error', error => { failHeaders(error); response.destroy(error); });
      incoming.on('end', async () => {
        if (request.method === 'POST') {
          if (incoming.statusCode !== 200 || !incoming.headers['set-cookie']) {
            failHeaders(new Error('Fixture admin login did not return a session cookie')); response.destroy(); return;
          }
          headersReady(); await gate;
        }
        response.end(Buffer.concat(chunks));
      });
    });
    upstream.on('error', error => { failHeaders(error); response.destroy(error); }); request.pipe(upstream);
  });
  const observe = async label => {
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, label); return page;
  };
  const login = async (page, username) => {
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill('BrowserFixtureAdmin123!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };
  try {
    await new Promise((resolve, reject) => { relay.once('error', reject); relay.listen(0, '127.0.0.1', resolve); });
    await localPlatformScripts(context);
    const stamp = `${Date.now()}`;
    const writes = { 'X-Requested-With': 'XMLHttpRequest', Origin: frontend };
    const registration = await context.request.post(`${api}/users/register`, {
      data: { username: `adminPublication${stamp}`, email: `adminPublication${stamp}@example.test`, password: 'DisposableAdminPublication123!' }, headers: writes,
    });
    assert.equal(registration.status(), 201);
    const target = (await registration.json()).user;
    const oldTab = await observe('admin-publication-a');
    await oldTab.goto(`${frontend}/admin/login`); await login(oldTab, 'admin');
    await oldTab.waitForURL(`${frontend}/admin/dashboard`);
    const first = (await (await context.request.get(`${api}/admin/profile`)).json()).admin;
    await oldTab.goto(`${frontend}/admin/users`);
    const row = oldTab.getByRole('row').filter({ hasText: target.email });
    await row.getByRole('button', { name: '禁用', exact: true }).waitFor({ state: 'visible' });
    const normal = oldTab.waitForRequest(request => request.url() === `${api}/admin/users/${target.user_id}/status` && request.method() === 'PUT');
    await row.getByRole('button', { name: '禁用', exact: true }).click();
    assert.equal((await normal).headers()['x-expected-admin-id'], String(first.admin_id));
    await row.getByRole('button', { name: '启用', exact: true }).click();
    await row.getByRole('button', { name: '禁用', exact: true }).waitFor({ state: 'visible' });
    await row.getByRole('button', { name: '禁用', exact: true }).evaluate(button => {
      const key = Object.keys(button).find(name => name.startsWith('__reactProps$'));
      const handler = button[key]?.onClick;
      if (typeof handler !== 'function') throw new Error('Rendered user action lacks a React handler');
      window.publicationOldAdminWrite = () => handler();
    });
    const logs = async () => {
      const response = await context.request.get(`${api}/admin/logs?limit=100`); assert.equal(response.status(), 200);
      return response.json();
    };
    const userStatus = async () => {
      const response = await context.request.get(`${api}/admin/users/${target.user_id}`); assert.equal(response.status(), 200);
      return (await response.json()).user.status;
    };
    const newTab = await observe('admin-publication-b');
    await newTab.goto(`${frontend}/admin/login`);
    await newTab.route(`${api}/admin/login`, route => route.continue({ url: `http://127.0.0.1:${relay.address().port}/api/admin/login` }));
    let protectedWrites = 0;
    context.on('request', request => {
      if (request.url() === `${api}/admin/users/${target.user_id}/status` && request.method() === 'PUT') protectedWrites++;
    });
    await login(newTab, 'admin_publication_b'); await headers;
    let second;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await context.request.get(`${api}/admin/profile`); assert.equal(response.status(), 200);
      second = (await response.json()).admin;
      if (second.username === 'admin_publication_b') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(second.username, 'admin_publication_b');
    assert.notEqual(second.admin_id, first.admin_id);
    assert.equal(await newTab.evaluate(() => localStorage.getItem('admin_session_cleanup_pending')), '1');
    assert.equal(await newTab.getByRole('button', { name: '登录中...', exact: true }).isVisible(), true);
    await row.getByRole('button', { name: '禁用', exact: true }).waitFor({ state: 'hidden' });
    const before = await logs();
    await oldTab.evaluate(() => window.publicationOldAdminWrite());
    assert.equal(protectedWrites, 0, 'a stale A action sends no request while B publication is pending');
    const mismatch = await context.request.put(`${api}/admin/users/${target.user_id}/status`, {
      data: { status: 0 }, headers: { ...writes, 'X-Expected-Admin-Id': String(first.admin_id) },
    });
    assert.equal(mismatch.status(), 409, 'expected A cannot act with the real B cookie');
    assert.equal(await userStatus(), 1);
    assert.deepEqual(await logs(), before, 'a rejected context performs no write and creates no audit record');
    releaseBody();
    await newTab.waitForURL(`${frontend}/admin/dashboard`);
    await newTab.getByText('Publication B', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await newTab.evaluate(() => localStorage.getItem('admin_session_cleanup_pending')), null);
    await oldTab.evaluate(() => window.publicationOldAdminWrite());
    assert.equal(protectedWrites, 0, 'the old A action remains retired after B publication');
    await newTab.goto(`${frontend}/admin/users`);
    const newRow = newTab.getByRole('row').filter({ hasText: target.email });
    const bWrite = newTab.waitForRequest(request => request.url() === `${api}/admin/users/${target.user_id}/status` && request.method() === 'PUT');
    await newRow.getByRole('button', { name: '禁用', exact: true }).click();
    assert.equal((await bWrite).headers()['x-expected-admin-id'], String(second.admin_id));
    await newRow.getByRole('button', { name: '启用', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await userStatus(), 0);
    console.log('PASS browser real administrator Cookie-before-JSON publication blocks stale actions, rejects mismatched accounts without audit writes and restores normal B operations');
  } finally {
    releaseBody(); await context.close(); relay.closeAllConnections(); await new Promise(resolve => relay.close(resolve));
  }
};
