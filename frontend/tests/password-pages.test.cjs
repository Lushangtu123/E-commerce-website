const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadApi, loadPage, loadSource, findElements } = require('./runtime.cjs');

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const form = tree => findElements(tree, node => node.type === 'form')[0];
const field = (tree, name) => findElements(tree, node => node.type === 'input' && node.props.name === name)[0];
const passwordFields = tree => findElements(tree, node => node.type === 'input' && node.props.type === 'password');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const user = { user_id: 1, username: 'Customer', email: 'customer@test' }, replacement = { user_id: 2, username: 'Replacement', email: 'replacement@test' };
const authImport = stores => ({ useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) });
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });

function changeContext(write = async () => ({})) {
  const stores = loadStores(); stores.useAuthStore.getState().login(user, 'session-a');
  const payloads = [];
  const runtime = loadPage('src/components/ChangePassword.tsx', { globals: stores, imports: {
    '@/store/useAuthStore': authImport(stores),
    '@/lib/api': { userApi: { changePassword: async data => { payloads.push(JSON.parse(JSON.stringify(data))); return write(data); } } },
  } });
  return { ...stores, runtime, payloads };
}
async function fillChange(context, values = { current: ' previous password ', next: ' next password 123 ', confirm: ' next password 123 ' }) {
  let tree = await context.runtime.flush();
  for (const [name, value] of Object.entries(values)) { field(tree, name).props.onChange({ target: { value } }); tree = await context.runtime.flush(); }
  return tree;
}

test('changing password preserves whitespace, revokes the invoking customer session and clears its cart only after success', async () => {
  const pending = deferred(), context = changeContext(() => pending.promise);
  context.useCartStore.getState().setItems([{ product_id: 1, quantity: 1, stock: 2, price: 10 }]);
  const tree = await fillChange(context), work = submit(tree), duplicate = submit(tree);
  assert.deepEqual(context.payloads, [{ currentPassword: ' previous password ', newPassword: ' next password 123 ' }]);
  const busyTree = await context.runtime.flush(); assert.ok(passwordFields(busyTree).every(node => node.props.disabled));
  assert.equal(context.useAuthStore.getState().token, 'session-a');
  pending.resolve({}); await Promise.all([work, duplicate]);
  assert.equal(context.useAuthStore.getState().isAuthenticated, false); assert.equal(context.localStorage.getItem('token'), null);
  assert.equal(context.useCartStore.getState().getTotalCount(), 0); assert.deepEqual(context.runtime.redirects, ['/login?passwordChanged=1']);
});

test('new password validation rejects short, mismatched, whitespace-only and excessive UTF-8 input before sending', async () => {
  for (const [next, confirm] of [['short', 'short'], [' valid password 123 ', 'different password'], [' '.repeat(12), ' '.repeat(12)], ['密'.repeat(25), '密'.repeat(25)]]) {
    const context = changeContext(), tree = await fillChange(context, { current: 'old', next, confirm });
    await submit(tree); assert.deepEqual(context.payloads, []); assert.ok(findElements(await context.runtime.flush(), node => node.props.role === 'alert').length);
  }
});

test('a replacement customer never sees old password drafts and cannot invoke old handlers', async () => {
  const context = changeContext(), previous = await fillChange(context);
  context.useAuthStore.getState().login(replacement, 'session-b');
  const immediate = await context.runtime.render();
  assert.ok(passwordFields(immediate).every(node => !node.props.value), 'The first replacement render must hide the old password draft');
  await submit(previous); assert.deepEqual(context.payloads, []);
  const tree = await context.runtime.flush(); assert.ok(passwordFields(tree).every(node => !node.props.value));
});

test('late password change success or failure cannot sign out, navigate or notify a replacement tab or unmounted page', async () => {
  for (const change of ['account', 'storage', 'unmount']) for (const outcome of ['success', 'failure']) {
    const pending = deferred(), context = changeContext(() => pending.promise), tree = await fillChange(context), work = submit(tree);
    if (change === 'account') { context.useAuthStore.getState().login(replacement, 'session-b'); await context.runtime.flush(); }
    if (change === 'storage') context.localStorage.setItem('token', 'session-b');
    if (change === 'unmount') context.runtime.unmount();
    if (outcome === 'success') pending.resolve({}); else pending.reject({ response: { data: { error: '当前密码错误' } } });
    await work; assert.deepEqual(context.runtime.redirects, []); assert.equal(context.useAuthStore.getState().isAuthenticated, true);
    if (change !== 'unmount') assert.ok(!text(await context.runtime.flush()).includes('当前密码错误'));
  }
});

function forgotContext({ available = true, capabilities, send = async () => ({ reset_url: 'https://secret.invalid/reset#token=DO-NOT-DISPLAY' }) } = {}) {
  const payloads = [];
  const runtime = loadPage('src/app/forgot-password/page.tsx', { imports: {
    '@/lib/api': { userApi: { passwordCapabilities: capabilities || (async () => ({ passwordResetAvailable: available })), forgotPassword: async email => { payloads.push(email); return send(email); } } },
  } });
  return { runtime, payloads };
}
test('forgot password stays unavailable if email capabilities are absent or fail, without issuing reset requests', async () => {
  for (const context of [forgotContext({ available: false }), forgotContext({ capabilities: async () => { throw new Error('Offline'); } })]) {
    let tree = await context.runtime.flush(); assert.ok(text(tree).includes('密码找回邮件服务暂不可用'));
    findElements(tree, node => node.type === 'input')[0].props.onChange({ target: { value: 'customer@example.test' } }); tree = await context.runtime.flush();
    await submit(tree); assert.deepEqual(context.payloads, []);
    assert.equal(findElements(tree, node => node.type === 'button')[0].props.disabled, true);
  }
});

test('forgot password deduplicates delivery and displays only generic confirmation, never a returned reset URL', async () => {
  const pending = deferred(), context = forgotContext({ send: () => pending.promise });
  let tree = await context.runtime.flush(); findElements(tree, node => node.type === 'input')[0].props.onChange({ target: { value: ' customer@example.test ' } }); tree = await context.runtime.flush();
  const first = submit(tree), duplicate = submit(tree); assert.deepEqual(context.payloads, ['customer@example.test']);
  pending.resolve({ message: 'https://secret.invalid', reset_url: 'https://secret.invalid/reset#token=DO-NOT-DISPLAY' }); await Promise.all([first, duplicate]);
  tree = await context.runtime.flush(); assert.ok(text(tree).includes('如果该邮箱已注册')); assert.ok(!text(tree).includes('secret.invalid')); assert.ok(!text(tree).includes('DO-NOT-DISPLAY'));
});

const resetToken = 'a'.repeat(64);
function resetContext({ strictEffects = false, hash = `#token=${resetToken}`, search = '', write = async () => ({}) } = {}) {
  const stores = loadStores(), payloads = [], replacements = [];
  stores.window.location = { ...stores.window.location, hash, pathname: '/reset-password', search };
  stores.window.history = { replaceState(_state, _title, url) { replacements.push(url); stores.window.location.hash = ''; } };
  const runtime = loadPage('src/app/reset-password/page.tsx', { strictEffects, globals: stores, imports: {
    '@/store/useAuthStore': authImport(stores),
    '@/lib/api': { userApi: { resetPassword: async data => { payloads.push(JSON.parse(JSON.stringify(data))); return write(data); } } },
  } });
  return { ...stores, runtime, payloads, replacements };
}
async function fillReset(context) {
  let tree = await context.runtime.flush();
  for (let i = 0; i < 2; i++) { passwordFields(tree)[i].props.onChange({ target: { value: ' preserved reset password ' } }); tree = await context.runtime.flush(); }
  return tree;
}
test('Strict Mode effect replay preserves the reset token after removing its fragment and never stores or renders it', async () => {
  const context = resetContext({ strictEffects: true }); let tree = await context.runtime.flush();
  assert.ok(form(tree), 'A valid one-time token must survive Strict Mode effect replay');
  assert.deepEqual(context.replacements, ['/reset-password']); assert.equal(context.window.location.hash, '');
  assert.ok(!text(tree).includes(resetToken)); assert.equal(context.localStorage.getItem('token'), null);
  tree = await fillReset(context); await submit(tree);
  assert.deepEqual(context.payloads, [{ token: resetToken, newPassword: ' preserved reset password ' }]);
  assert.ok(text(await context.runtime.flush()).includes('密码已重置')); assert.equal(form(await context.runtime.flush()), undefined);
});

test('malformed reset fragments and credentials passed in a query cannot reach the API', async () => {
  for (const options of [{ hash: '#token=short' }, { hash: '', search: `?token=${resetToken}` }, { hash: `#token=${resetToken}&other=1` }]) {
    const context = resetContext(options), tree = await context.runtime.flush();
    assert.ok(text(tree).includes('重置链接无效或已过期')); assert.equal(form(tree), undefined); assert.deepEqual(context.payloads, []);
  }
});

test('reset submissions are deduplicated and success never clears a customer who logged in while the request was pending', async () => {
  const pending = deferred(), context = resetContext({ write: () => pending.promise });
  context.useAuthStore.getState().login(user, 'session-a');
  const tree = await fillReset(context), first = submit(tree), duplicate = submit(tree);
  assert.equal(context.payloads.length, 1); context.useAuthStore.getState().login(replacement, 'session-b');
  pending.resolve({}); await Promise.all([first, duplicate]);
  assert.equal(context.useAuthStore.getState().token, 'session-b'); assert.equal(context.localStorage.getItem('token'), 'session-b');
});

test('password requirements count UTF-8 bytes and preserve meaningful leading spaces', () => {
  const { passwordError } = loadSource('src/lib/password-validation.ts');
  assert.equal(passwordError('密'.repeat(24)), null); assert.ok(passwordError('密'.repeat(25)));
  assert.equal(passwordError(' password 123 '), null); assert.ok(passwordError(' '.repeat(12)));
});

test('recovery and capability endpoints remain anonymous while password changes require the invoking customer identity', async () => {
  const api = loadApi({ token: 'customer-a', admin_token: 'admin-a' });
  api.localStorage.setItem('token', 'other-tab-customer');
  await api.userApi.passwordCapabilities(); await api.userApi.forgotPassword('customer@example.test'); await api.userApi.resetPassword({ token: resetToken, newPassword: 'new password 123' }); await api.paymentApi.getSettings();
  assert.ok(api.requests.every(config => !config.headers.get('Authorization')), 'Public recovery requests must carry neither customer nor administrator credentials');
  await assert.rejects(api.userApi.changePassword({ currentPassword: 'old', newPassword: 'new password 123' }), /登录状态已变化/);
  assert.equal(api.requests.length, 4);
});

test('an invalid reset token is discarded and the reset page offers a fresh request instead of resubmitting it', async () => {
  const context = resetContext({ write: async () => { throw { response: { status: 400, data: { error: '密码重置链接无效或已过期', code: 'INVALID_RESET_TOKEN' } } }; } });
  const tree = await fillReset(context); await submit(tree);
  const failed = await context.runtime.flush(); assert.equal(form(failed), undefined); assert.ok(text(failed).includes('重新申请重置邮件')); assert.equal(context.payloads.length, 1);
});

function passwordSettingsContext() {
  const stores = loadStores(); stores.useAuthStore.getState().login(user, 'session-a');
  const redirects = [], router = { push: path => redirects.push(path) }, ChangePassword = () => null;
  const imports = {
    '@/store/useAuthStore': authImport(stores),
    '@/lib/api': { userApi: { getProfile: async () => ({ user }), changePassword: async () => ({ reauthenticate: true }) } },
    'next/navigation': { useRouter: () => router },
  };
  const parent = loadPage('src/app/profile/settings/page.tsx', { globals: stores, imports: { ...imports, '@/components/ChangePassword': ChangePassword } });
  return { ...stores, imports, redirects, ChangePassword, parent };
}

test('a successful settings password change retains its success URL when the parent reacts to the revoked session', async () => {
  const context = passwordSettingsContext(), parentTree = await context.parent.flush();
  const child = findElements(parentTree, node => node.type === context.ChangePassword)[0];
  const runtime = loadPage('src/components/ChangePassword.tsx', { globals: context, imports: context.imports, props: child.props });
  const childContext = { ...context, runtime };
  const formTree = await fillChange(childContext); await submit(formTree);
  assert.equal(context.useAuthStore.getState().isAuthenticated, false);
  await context.parent.flush();
  assert.ok(context.redirects.length >= 1);
  assert.ok(context.redirects.every(path => path === '/login?passwordChanged=1'), 'The parent redirect must preserve the completed password change notice');
});

test('ordinary session loss still redirects settings to login and an obsolete password callback cannot mark a new session changed', async () => {
  for (const scenario of ['session-loss', 'replacement']) {
    const context = passwordSettingsContext(), previous = await context.parent.flush();
    const oldChild = findElements(previous, node => node.type === context.ChangePassword)[0];
    if (scenario === 'replacement') {
      context.useAuthStore.getState().login(replacement, 'session-b'); await context.parent.render();
      oldChild.props.onPasswordChanged?.();
    }
    context.useAuthStore.getState().logout(); await context.parent.flush();
    assert.equal(context.redirects.at(-1), '/login');
  }
});
