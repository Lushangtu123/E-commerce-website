const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, loadPage, findElements } = require('./runtime.cjs');

const admin = { admin_id: 1, username: 'root', role_name: '管理员' };

function login(respond) {
  const browser = createBrowser();
  const requests = [];
  const toasts = [];
  const fetch = async (url, init) => { requests.push({ url, ...init, body: JSON.parse(init.body) }); return respond(); };
  const runtime = loadPage('src/app/admin/login/page.tsx', {
    globals: { ...browser, fetch, process: { env: {} }, document: { title: '' } },
    imports: { 'react-hot-toast': { __esModule: true, default: { success: (message) => toasts.push(['success', message]), error: (message) => toasts.push(['error', message]) } } },
  });
  const byId = (tree, id) => findElements(tree, (element) => element.props.id === id)[0];
  const submit = async () => {
    let tree = await runtime.flush();
    byId(tree, 'admin-username').props.onChange({ target: { value: 'root' } });
    tree = await runtime.flush();
    byId(tree, 'admin-password').props.onChange({ target: { value: 'secret-pass' } });
    tree = await runtime.flush();
    await findElements(tree, (element) => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    return runtime.flush();
  };
  return { ...browser, runtime, requests, toasts, byId, submit };
}

const json = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('admin login labels name their inputs for assistive technology and password managers', async () => {
  const context = login(json(200, {}));
  const tree = await context.runtime.flush();
  const labels = findElements(tree, (element) => element.type === 'label').map((element) => element.props.htmlFor);
  assert.deepEqual([...labels], ['admin-username', 'admin-password']);
  assert.equal(context.byId(tree, 'admin-username').props.autoComplete, 'username');
  assert.equal(context.byId(tree, 'admin-password').props.autoComplete, 'current-password');
});

test('a successful admin login stores the session and opens the dashboard', async () => {
  const context = login(json(200, { token: 'admin-token', admin }));
  await context.submit();
  assert.equal(context.requests.length, 1);
  assert.equal(context.requests[0].url, '/api/admin/login');
  assert.deepEqual({ ...context.requests[0].body }, { username: 'root', password: 'secret-pass' });
  assert.equal(context.localStorage.getItem('admin_token'), 'admin-token');
  assert.deepEqual(JSON.parse(context.localStorage.getItem('admin_user')), admin);
  assert.deepEqual([...context.runtime.redirects], ['/admin/dashboard']);
});

test('rejected, malformed and unreachable admin logins never store a session', async () => {
  const cases = [
    [json(401, { error: '用户名或密码错误' }), '用户名或密码错误'],
    [json(200, { admin }), '登录失败'],
    [json(200, { token: '', admin }), '登录失败'],
    [async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }), '登录失败，请稍后重试'],
    [async () => { throw new TypeError('Failed to fetch'); }, '登录失败，请稍后重试'],
  ];
  for (const [respond, message] of cases) {
    const context = login(respond);
    const tree = await context.submit();
    assert.equal(context.localStorage.getItem('admin_token'), null, message);
    assert.deepEqual([...context.runtime.redirects], [], message);
    assert.deepEqual(context.toasts.map(([kind, text]) => [kind, text]), [['error', message]]);
    const button = findElements(tree, (element) => element.type === 'button' && element.props.type === 'submit')[0];
    assert.equal(button.props.disabled, false, `${message}: the form must be usable again`);
  }
});
