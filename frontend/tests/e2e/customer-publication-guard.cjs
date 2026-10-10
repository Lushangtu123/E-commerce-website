const assert = require('node:assert/strict');
const http = require('node:http');

/** Runs only inside commerce.cjs's disposable loopback MySQL fixture. */
module.exports = async function customerPublicationGuard({ browser, localPlatformScripts, watchConsole, errors }) {
  const storefront = 'http://127.0.0.1:3100';
  const api = 'http://127.0.0.1:3101/api';
  const context = await browser.newContext();
  let releaseBody, headersReady, failHeaders;
  const bodyGate = new Promise(resolve => { releaseBody = resolve; });
  const headers = new Promise((resolve, reject) => { headersReady = resolve; failHeaders = reject; });
  // A real HTTP relay flushes the backend's Set-Cookie headers and deliberately withholds JSON.
  // Playwright route.fetch/fulfill would not reproduce the browser's header/body ordering.
  const relay = http.createServer((request, response) => {
    if (request.url !== '/api/users/login' || !['POST', 'OPTIONS'].includes(request.method)) {
      response.writeHead(404).end(); return;
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: 3101, path: request.url, method: request.method,
      headers: { ...request.headers, host: '127.0.0.1:3101' } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      response.flushHeaders();
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('error', error => { failHeaders(error); response.destroy(error); });
      incoming.on('end', async () => {
        if (request.method === 'POST') {
          if (incoming.statusCode !== 200 || !incoming.headers['set-cookie']) {
            failHeaders(new Error('Disposable login did not return a session cookie')); response.destroy(); return;
          }
          headersReady(); await bodyGate;
        }
        response.end(Buffer.concat(chunks));
      });
    });
    upstream.on('error', error => { failHeaders(error); response.destroy(error); });
    request.pipe(upstream);
  });
  try {
    await new Promise((resolve, reject) => { relay.once('error', reject); relay.listen(0, '127.0.0.1', resolve); });
    const relayLogin = `http://127.0.0.1:${relay.address().port}/api/users/login`;
    await localPlatformScripts(context);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const password = 'DisposablePublication123!';
    const first = { username: `publicationA${stamp}`, email: `publicationA${stamp}@example.test`, password };
    const second = { username: `publicationB${stamp}`, email: `publicationB${stamp}@example.test`, password };
    const writeHeaders = { 'X-Requested-With': 'XMLHttpRequest', Origin: storefront };
    const createFirst = await context.request.post(`${api}/users/register`, { data: first, headers: writeHeaders });
    assert.equal(createFirst.status(), 201);
    const firstUser = (await createFirst.json()).user;
    const createSecond = await context.request.post(`${api}/users/register`, { data: second, headers: writeHeaders });
    assert.equal(createSecond.status(), 201);
    const secondUser = (await createSecond.json()).user;
    const oldTab = await context.newPage(); oldTab.setDefaultTimeout(30000);
    oldTab.on('pageerror', error => errors.push(error.message)); watchConsole(oldTab, 'publication-old-tab');
    await oldTab.goto(`${storefront}/login`);
    await oldTab.getByLabel('邮箱', { exact: true }).fill(first.email);
    await oldTab.getByLabel('密码', { exact: true }).fill(password);
    await oldTab.getByRole('button', { name: '登录', exact: true }).click();
    await oldTab.waitForURL(`${storefront}/`);
    await oldTab.goto(`${storefront}/profile/settings`);
    await oldTab.getByLabel('用户名', { exact: true }).fill(`publicationSaved${stamp}`);
    const normalWrite = oldTab.waitForRequest(request => request.url() === `${api}/users/profile` && request.method() === 'PUT');
    await oldTab.getByRole('button', { name: '保存修改', exact: true }).click();
    assert.equal((await normalWrite).headers()['x-expected-customer-id'], String(firstUser.user_id));
    await oldTab.getByText('资料已保存', { exact: true }).waitFor({ state: 'visible' });
    assert.equal((await (await context.request.get(`${api}/users/profile`)).json()).user.username, `publicationSaved${stamp}`);
    await oldTab.getByLabel('用户名', { exact: true }).fill(`publicationStale${stamp}`);
    // Keep the submitted draft's real React handler, as a queued event can outlive its rendered form.
    await oldTab.evaluate(() => {
      const form = document.querySelector('input[name="username"]').closest('form');
      const key = Object.keys(form).find(name => name.startsWith('__reactProps$'));
      const submit = form[key]?.onSubmit;
      if (typeof submit !== 'function') throw new Error('The rendered settings form has no React submit handler');
      window.publicationSaveDraft = () => submit({ preventDefault() {} });
    });
    let protectedWrites = 0;
    context.on('request', request => {
      if (request.url() === `${api}/users/profile` && request.method() === 'PUT') protectedWrites++;
    });
    const newTab = await context.newPage(); newTab.setDefaultTimeout(30000);
    newTab.on('pageerror', error => errors.push(error.message)); watchConsole(newTab, 'publication-new-tab');
    await newTab.goto(`${storefront}/login`);
    await newTab.route(`${api}/users/login`, route => route.continue({ url: relayLogin }));
    await newTab.getByLabel('邮箱', { exact: true }).fill(second.email);
    await newTab.getByLabel('密码', { exact: true }).fill(password);
    await newTab.getByRole('button', { name: '登录', exact: true }).click();
    await headers;
    // The browser has applied B's real HttpOnly cookie, although B's sign-in promise is pending.
    let cookieProfile;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await context.request.get(`${api}/users/profile`);
      assert.equal(response.status(), 200); cookieProfile = (await response.json()).user;
      if (cookieProfile.user_id === secondUser.user_id) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(cookieProfile.user_id, secondUser.user_id);
    assert.equal(await newTab.evaluate(() => localStorage.getItem('customer_session_cleanup_pending')), '1');
    assert.equal(await newTab.getByRole('button', { name: '登录中...', exact: true }).isVisible(), true);
    await oldTab.waitForURL(`${storefront}/login`);
    assert.equal(await oldTab.locator('input[name="username"]').count(), 0, 'the pending marker hides the older account form');
    await oldTab.evaluate(() => window.publicationSaveDraft());
    assert.equal(protectedWrites, 0, 'the old draft never reaches the backend while publication is pending');
    // The expected-ID check also closes a request whose cookie changes after the client guard.
    const mismatched = await context.request.put(`${api}/users/profile`, {
      data: { username: `publicationWrong${stamp}`, phone: null, avatar_url: null },
      headers: { ...writeHeaders, 'X-Expected-Customer-Id': String(firstUser.user_id) },
    });
    assert.equal(mismatched.status(), 409);
    assert.equal((await (await context.request.get(`${api}/users/profile`)).json()).user.username, second.username);
    releaseBody();
    await newTab.waitForURL(`${storefront}/`);
    await newTab.getByText(second.username, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await newTab.evaluate(() => localStorage.getItem('customer_session_cleanup_pending')), null);
    assert.equal((await (await context.request.get(`${api}/users/profile`)).json()).user.user_id, secondUser.user_id);
    const loginFirst = await context.request.post(`${api}/users/login`, { data: { email: first.email, password }, headers: writeHeaders });
    assert.equal(loginFirst.status(), 200);
    assert.equal((await (await context.request.get(`${api}/users/profile`)).json()).user.username, `publicationSaved${stamp}`);
    console.log('PASS browser pending real HttpOnly cookie publication blocks an old profile draft, rejects a mismatched expected customer and preserves both local fixture accounts');
  } finally {
    releaseBody();
    await context.close();
    relay.closeAllConnections();
    await new Promise(resolve => relay.close(resolve));
  }
};
