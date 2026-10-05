const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi, loadPage, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';

test('failed login and registration preserve visible feedback and never log the request or its password', async () => {
  for (const route of ['login', 'register']) {
    const browser = loadApi({ token: 'current-customer', admin_token: 'current-admin' }), logs = [], errors = [];
    browser.window.location.search = '?passwordChanged=1'; browser.window.location.href = '/login?passwordChanged=1';
    browser.default.defaults.adapter = async config => {
      throw Object.assign(new Error('Sensitive request failure'), { config, response: { status: 401, data: { error: '邮箱或密码错误' } } });
    };
    const runtime = loadPage(`src/app/${route}/page.tsx`, { globals: { ...browser, TextEncoder }, imports: {
      '@/lib/api': browser,
      '@/store/useAuthStore': { useAuthStore: Object.assign(() => browser.useAuthStore.getState(), { getState: browser.useAuthStore.getState }) },
      '@/lib/logger': { logger: { error: (...args) => logs.push(args) } },
      'react-hot-toast': { __esModule: true, default: { error: value => errors.push(value), success() {} } },
    } });
    let tree = await runtime.flush();
    const values = route === 'login' ? [['email', 'customer@example.test'], ['password', 'private-test-password']] : [['username', 'Customer'], ['email', 'customer@example.test'], ['password', 'private-test-password'], ['confirmPassword', 'private-test-password']];
    for (const [name, value] of values) {
      const input = findElements(tree, node => node.type === 'input' && (route === 'register' ? node.props.name === name : node.props.type === name))[0];
      input.props.onChange({ target: { name, value } }); tree = await runtime.flush();
    }
    await findElements(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await runtime.flush();
    assert.deepEqual(errors, ['邮箱或密码错误']); assert.equal(browser.window.location.href, '/login?passwordChanged=1');
    assert.equal(browser.localStorage.getItem('token'), 'current-customer'); assert.equal(browser.localStorage.getItem('admin_token'), 'current-admin'); assert.deepEqual(runtime.redirects, []);
    if (route === 'login') assert.ok(text(tree).includes('密码已修改，请使用新密码登录'));
    assert.equal(logs.length, 1); assert.ok(logs[0].every(value => typeof value === 'string'), 'Credential-bearing errors must not be passed to the logger');
    assert.ok(!JSON.stringify(logs).includes('private-test-password')); assert.ok(!JSON.stringify(logs).includes('customer@example.test'));
  }
});
