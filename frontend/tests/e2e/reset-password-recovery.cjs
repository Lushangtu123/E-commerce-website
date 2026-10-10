const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const path = require('node:path');

/** Seed capabilities only in the explicitly named throwaway commerce fixture, never send email. */
module.exports = async function resetPasswordRecovery({ browser, localPlatformScripts, watchConsole, errors, fixtureDatabase, setExpectedWrite }) {
  assert.match(fixtureDatabase, /^ecommerce_e2e_[1-9]\d*$/, 'password reset browser proof requires the isolated fixture database');
  const socket = process.env.MYSQL_TEST_SOCKET;
  const host = process.env.MYSQL_TEST_HOST;
  assert.ok(socket || host, 'password reset browser proof requires explicit local MySQL test configuration');
  if (host) assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'MySQL test host must be loopback');
  if (socket) assert.ok(path.isAbsolute(socket), 'MySQL test socket must be an absolute local path');
  const port = Number(process.env.MYSQL_TEST_PORT || 3306);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'MySQL test port must be valid');
  const mysql = require('../../../backend/node_modules/mysql2/promise');
  const connection = await mysql.createConnection({
    ...(socket ? { socketPath: socket } : { host, port }), database: fixtureDatabase,
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00',
  });
  const base = 'http://127.0.0.1:3100';
  const api = 'http://127.0.0.1:3101/api';
  const endpoint = `${api}/users/password/reset`;
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const unknown = '重置密码结果尚未确认，请先尝试用新密码登录；若无法登录，请重新申请重置邮件';
  const englishUnknown = 'The password reset result is unconfirmed. Try signing in with your new password first. If that fails, request a new reset email.';
  try {
    const [[database]] = await connection.query('SELECT DATABASE() AS name');
    assert.equal(database.name, fixtureDatabase);
    for (const outcome of ['lost reply', 'malformed receipt']) {
      const context = await browser.newContext();
      try {
        await localPlatformScripts(context);
        const suffix = randomBytes(6).toString('hex');
        const account = { username: `reset${suffix}`, email: `reset${suffix}@example.test`, password: 'OriginalFixturePassword123!' };
        const registered = await context.request.post(`${api}/users/register`, { data: account, headers });
        assert.equal(registered.status(), 201);
        const [[owner]] = await connection.execute('SELECT user_id, auth_version FROM users WHERE email = ?', [account.email]);
        assert.ok(Number.isSafeInteger(owner.user_id) && owner.user_id > 0);
        const token = randomBytes(32).toString('hex');
        const digest = createHash('sha256').update(token).digest('hex');
        await connection.execute(
          'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), UTC_TIMESTAMP(3))',
          [digest, owner.user_id],
        );
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.message));
        watchConsole(page, `password-reset-${outcome}`);
        const login = async password => {
          await page.goto(`${base}/login`);
          await page.getByLabel('邮箱', { exact: true }).fill(account.email);
          await page.getByLabel('密码', { exact: true }).fill(password);
          await page.getByRole('button', { name: '登录', exact: true }).click();
          await page.waitForURL(`${base}/`);
          await page.getByText(account.username, { exact: true }).waitFor({ state: 'visible' });
        };
        await login(account.password);
        const nextPassword = `ChangedFixturePassword${suffix}!`;
        let writes = 0;
        await page.route(endpoint, async route => {
          if (route.request().method() !== 'POST') return route.continue();
          writes += 1;
          assert.deepEqual(route.request().postDataJSON(), { token, newPassword: nextPassword });
          const response = await route.fetch();
          assert.equal(response.status(), 200, 'the real reset must commit before injecting an uncertain reply');
          assert.equal((await response.json()).reauthenticate, true);
          if (outcome === 'lost reply') return route.abort('failed');
          return route.fulfill({ response, json: {} });
        });
        await page.goto(`${base}/reset-password#token=${token}`);
        await page.getByLabel('新密码', { exact: true }).fill(nextPassword);
        await page.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
        assert.equal(new URL(page.url()).hash, '', 'the capability fragment is removed before submission');
        if (outcome === 'lost reply') setExpectedWrite({ endpoint });
        await page.getByRole('button', { name: '设置新密码', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: unknown }).waitFor({ state: 'visible' });
        setExpectedWrite(undefined);
        assert.equal(await page.locator('input[type="password"]').count(), 0, 'uncertain resets clear both password drafts');
        assert.equal(await page.getByRole('button', { name: '设置新密码', exact: true }).count(), 0, 'the consumed token cannot be resubmitted');
        assert.equal(await page.getByRole('status').filter({ hasText: '密码已重置' }).count(), 0, 'an uncertain reply is never reported as confirmed success');
        const storage = await page.evaluate(() => [localStorage, sessionStorage].flatMap(store => Array.from({ length: store.length }, (_, index) => store.getItem(store.key(index)))).join('\n'));
        assert.equal(storage.includes(token), false, 'one-time tokens never enter browser storage');
        assert.equal(storage.includes(nextPassword), false, 'password drafts never enter browser storage');
        await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
        await page.getByRole('alert').filter({ hasText: englishUnknown }).waitFor({ state: 'visible' });
        await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
        await page.getByRole('alert').filter({ hasText: unknown }).waitFor({ state: 'visible' });
        await page.keyboard.press('Enter');
        assert.equal(writes, 1, 'recovery and language switching never repeat the reset POST');
        const [[remaining]] = await connection.execute('SELECT COUNT(*) AS count FROM password_reset_tokens WHERE token_hash = ?', [digest]);
        assert.equal(Number(remaining.count), 0, 'the real one-time token was consumed');
        const [[updated]] = await connection.execute('SELECT auth_version FROM users WHERE user_id = ?', [owner.user_id]);
        assert.equal(Number(updated.auth_version), Number(owner.auth_version) + 1, 'the reset changed the password exactly once');
        await login(nextPassword);
        assert.equal(writes, 1);
        console.log(`PASS browser real MySQL password reset ${outcome} clears credentials, recovers bilingually and signs in with the committed new password without retrying`);
      } finally {
        setExpectedWrite(undefined);
        await context.close();
      }
    }
    await resetLinkNavigation({ browser, localPlatformScripts, watchConsole, errors, base, endpoint });
  } finally { await connection.end(); }
};

/** Synthetic replies stay inside the browser; real one-time SQL consumption is checked above. */
async function resetLinkNavigation({ browser, localPlatformScripts, watchConsole, errors, base, endpoint }) {
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  const password = 'NavigationFixturePassword123!';
  for (const scenario of ['invalid tab', 'unused link', 'late confirmed', 'late unknown', 'return while pending']) {
    const context = await browser.newContext(); let release;
    try {
      await localPlatformScripts(context);
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      const content = page.locator('main');
      page.on('pageerror', error => errors.push(error.message)); watchConsole(page, `reset-navigation-${scenario}`);
      const posted = [];
      const gate = new Promise(resolve => { release = resolve; });
      let started;
      const dispatched = new Promise(resolve => { started = resolve; });
      await page.route(endpoint, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON(); posted.push(body.token);
        assert.equal(body.newPassword, password);
        if (body.token === first && (scenario.startsWith('late') || scenario === 'return while pending')) {
          started(); await gate;
        }
        await route.fulfill({ status: 200, json: scenario === 'late unknown' && body.token === first ? {} : { reauthenticate: true } });
      });
      await page.goto(`${base}/reset-password?source=email${scenario === 'invalid tab' ? '' : `#token=${first}`}`);
      await content.locator(scenario === 'invalid tab' ? '[role="alert"]' : 'form').waitFor({ state: 'visible' });
      const stamp = await page.evaluate(() => {
        window.resetNavigationDocument = crypto.randomUUID();
        return window.resetNavigationDocument;
      });
      const fill = async () => {
        await page.getByLabel('新密码', { exact: true }).fill(password);
        await page.getByLabel('确认新密码', { exact: true }).fill(password);
      };
      const navigate = async token => {
        await page.evaluate(token => { location.hash = `token=${token}`; }, token);
        await page.waitForFunction(() => !location.hash);
        assert.equal(await page.evaluate(() => window.resetNavigationDocument), stamp, 'hash-only navigation preserves the same document');
        assert.equal(new URL(page.url()).search, '?source=email');
      };
      if (scenario === 'unused link') {
        await fill();
        await content.locator('form').evaluate(form => {
          const key = Object.keys(form).find(name => name.startsWith('__reactProps$'));
          const submit = form[key]?.onSubmit;
          if (typeof submit !== 'function') throw new Error('Rendered reset form lacks a React handler');
          window.oldResetNavigationSubmit = () => submit({ preventDefault() {} });
        });
      }
      if (scenario.startsWith('late') || scenario === 'return while pending') {
        await fill(); await page.getByRole('button', { name: '设置新密码', exact: true }).click(); await dispatched;
      }
      await navigate(second);
      await content.locator('form').waitFor({ state: 'visible' });
      for (const input of await page.locator('input[type="password"]').all()) assert.equal(await input.inputValue(), '');
      if (scenario.startsWith('late') || scenario === 'return while pending') {
        assert.equal(await page.getByLabel('新密码', { exact: true }).isDisabled(), true);
        if (scenario === 'return while pending') {
          await navigate(first); assert.equal(await content.locator('form').count(), 0);
        }
        release();
        if (scenario === 'return while pending') {
          await content.getByRole('alert').waitFor({ state: 'visible' });
          await navigate(second);
        }
        await page.getByLabel('新密码', { exact: true }).waitFor({ state: 'visible' });
        await page.waitForFunction(() => !document.querySelector('input[type="password"]').disabled);
        assert.equal(await content.getByRole('status').count(), 0);
        assert.equal(await content.getByRole('alert').count(), 0, 'late A outcomes cannot overwrite the fresh B form');
      }
      if (scenario === 'unused link') await page.evaluate(() => window.oldResetNavigationSubmit());
      assert.deepEqual(posted, scenario.startsWith('late') || scenario === 'return while pending' ? [first] : []);
      await fill(); await page.getByRole('button', { name: '设置新密码', exact: true }).click();
      await content.getByRole('status').filter({ hasText: '密码已重置' }).waitFor({ state: 'visible' });
      assert.equal(posted.at(-1), second, 'only an explicit new submission uses the replacement capability');
      await navigate(second);
      assert.equal(await content.locator('form').count(), 0, 'a duplicate consumed capability is not republished');
      console.log(`PASS browser same-document reset link ${scenario} strips fragments, retires stale handlers and submits only the current capability`);
    } finally { release?.(); await context.close(); }
  }
}
