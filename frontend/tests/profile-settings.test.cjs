const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadApi, loadSource, loadPage, findElements } = require('./runtime.cjs');
const user = { user_id: 1, username: '旧名字', email: 'customer@example.test', phone: 'old phone', avatar_url: 'https://example.test/old.png' };

test('profile updates survive rehydration without clearing the cart or accepting private account fields', () => {
  const context = loadStores();
  context.useAuthStore.getState().login(user, 'session-one');
  const cart = [{ product_id: 1, quantity: 2, price: 10 }];
  context.useCartStore.getState().setItems(cart);
  context.useAuthStore.getState().updateUser({ username: '新名字', phone: null, avatar_url: null, password_hash: 'private' }, 'session-one');
  assert.equal(JSON.parse(context.localStorage.getItem('user')).username, '新名字');
  context.useAuthStore.getState().hydrate();
  assert.equal(context.useAuthStore.getState().user.username, '新名字');
  assert.equal(context.useAuthStore.getState().user.phone, null);
  assert.equal(context.useAuthStore.getState().user.password_hash, undefined);
  assert.equal(context.useCartStore.getState().items.length, 1);
  assert.equal(context.localStorage.getItem('token'), 'session-one');
});

test('a profile update cannot replace a different customer or a renewed session', () => {
  for (const scenario of ['account', 'token', 'storage', 'storage_user']) {
    const context = loadStores();
    context.useAuthStore.getState().login(user, 'session-one');
    if (scenario === 'account') context.useAuthStore.getState().login({ ...user, user_id: 2, username: 'another' }, 'session-two');
    if (scenario === 'token') context.useAuthStore.getState().login(user, 'session-two');
    if (scenario === 'storage') context.localStorage.setItem('token', 'session-two');
    if (scenario === 'storage_user') context.localStorage.setItem('user', JSON.stringify({ ...user, user_id: 2 }));
    const before = context.useAuthStore.getState().user;
    const storage = context.localStorage.getItem('user');
    context.useAuthStore.getState().updateUser({ ...user, username: 'late update' }, 'session-one');
    assert.deepEqual(context.useAuthStore.getState().user, before);
    assert.equal(context.localStorage.getItem('user'), storage);
  }
});

test('profile exposes a link to edit account details', async () => {
  const context = loadStores(); context.useAuthStore.getState().login(user, 'session-one');
  const page = loadPage('src/app/profile/page.tsx', { globals: context, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => context.useAuthStore.getState(), { getState: context.useAuthStore.getState }) },
    '@/lib/api': { userApi: { getStats: async () => ({ stats: { totalOrders: 0, pendingOrders: 0, totalCoupons: 0, availableCoupons: 0, favoriteCount: 0 } }) } },
  } });
  const tree = await page.flush({});
  assert.equal(findElements(tree, element => element.props.href === '/profile/settings').length, 1);
});

const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const input = (tree, name) => findElements(tree, element => element.type === 'input' && element.props.name === name)[0];
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const submit = tree => findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function settings({ getProfile = async () => ({ user }), save = async body => ({ user: { ...user, ...body } }), locale = 'zh-CN' } = {}) {
  const browser = loadApi({ token: 'session-one', user: JSON.stringify(user), admin_token: 'administrator' });
  const localeStore = loadSource('src/store/useLocaleStore.ts', browser);
  localeStore.useLocaleStore.getState().setLocale(locale);
  const i18n = loadSource('src/lib/i18n.ts', browser, { '@/store/useLocaleStore': localeStore });
  const requests = [];
  browser.default.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, body, authorization: config.headers.get('Authorization'), url: config.url });
    const data = config.method === 'get' ? await getProfile(config) : await save(body, config);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const page = loadPage('src/app/profile/settings/page.tsx', { globals: browser, imports: {
    '@/lib/api': browser,
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => browser.useAuthStore.getState(), { getState: browser.useAuthStore.getState }) },
    '@/lib/i18n': { ...i18n, useI18n: () => ({ t: i18n.translate, locale: localeStore.useLocaleStore.getState().locale }) },
  } });
  return { ...browser, page, requests, localeStore };
}

async function edit(context, tree, values) {
  for (const [name, value] of Object.entries(values)) {
    input(tree, name).props.onChange({ target: { value, name } });
    tree = await context.page.flush({});
  }
  return tree;
}

test('settings loads current server details and preserves a read-only email', async () => {
  const context = settings({ getProfile: async () => ({ user: { ...user, username: '服务器资料', phone: null } }) });
  const tree = await context.page.flush({});
  assert.equal(input(tree, 'username').props.value, '服务器资料');
  assert.equal(input(tree, 'phone').props.value, '');
  assert.equal(input(tree, 'email').props.readOnly, true);
  assert.equal(input(tree, 'email').props.value, user.email);
  assert.equal(input(tree, 'username').props.maxLength, 50);
  assert.equal(input(tree, 'phone').props.maxLength, 20);
  assert.equal(input(tree, 'avatar_url').props.maxLength, 255);
  assert.equal(button(tree, '保存修改').props.disabled, true);
  assert.equal(context.useAuthStore.getState().user.username, '服务器资料');
  await submit(tree);
  assert.deepEqual(context.requests.map(request => request.method), ['get']);
});

test('settings saves only permitted normalized fields and clears phone/avatar across refresh', async () => {
  const context = settings({ save: async body => ({ user: { ...user, ...body, username: '服务器确认名', password_hash: 'private' } }) });
  context.useCartStore.getState().setItems([{ product_id: 1, quantity: 2, price: 10 }]);
  let tree = await context.page.flush({});
  tree = await edit(context, tree, { username: '  新名字  ', phone: '  ', avatar_url: '' });
  await submit(tree); tree = await context.page.flush();
  assert.deepEqual(context.requests[1], { method: 'put', body: { username: '新名字', phone: null, avatar_url: null }, authorization: 'Bearer session-one', url: '/users/profile' });
  assert.equal(input(tree, 'username').props.value, '服务器确认名');
  assert.ok(text(tree).includes('资料已保存'));
  context.useAuthStore.getState().hydrate();
  assert.equal(context.useAuthStore.getState().user.username, '服务器确认名');
  assert.equal(context.useAuthStore.getState().user.phone, null);
  assert.equal(context.useAuthStore.getState().user.password_hash, undefined);
  assert.equal(context.useCartStore.getState().items.length, 1);
  assert.equal(context.localStorage.getItem('admin_token'), 'administrator');
});

test('failed load can retry and server conflicts preserve drafts for correction', async () => {
  let attempts = 0;
  const context = settings({ getProfile: async () => { if (++attempts === 1) throw new Error('offline'); return { user }; },
    save: async () => { throw { response: { data: { error: '用户名已被使用' } } }; } });
  let tree = await context.page.flush({});
  assert.ok(text(tree).includes('加载个人资料失败'));
  assert.equal(findElements(tree, element => element.type === 'form').length, 0);
  await button(tree, '重新加载资料').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { username: '保留修改' });
  await submit(tree); tree = await context.page.flush();
  assert.equal(input(tree, 'username').props.value, '保留修改');
  assert.ok(text(tree).includes('用户名已被使用'));
  button(tree, '撤销修改').props.onClick(); tree = await context.page.flush();
  assert.equal(input(tree, 'username').props.value, user.username);
  assert.equal(button(tree, '保存修改').props.disabled, true);
});

test('pending save blocks repeated submits and disables editable fields', async () => {
  const pending = deferred(); const context = settings({ save: () => pending.promise });
  let tree = await context.page.flush({}); tree = await edit(context, tree, { username: 'new' });
  const first = submit(tree); const second = submit(tree);
  await new Promise(setImmediate); tree = await context.page.flush();
  assert.equal(context.requests.filter(request => request.method === 'put').length, 1);
  assert.ok(['username', 'phone', 'avatar_url'].every(name => input(tree, name).props.disabled));
  assert.equal(button(tree, '保存中...').props.disabled, true);
  pending.resolve({ user: { ...user, username: 'new' } }); await Promise.all([first, second]);
  assert.ok(text(await context.page.flush()).includes('资料已保存'));
});

test('English settings and asynchronous errors follow language changes without translating user content', async () => {
  const pending = deferred(); const context = settings({ locale: 'en', save: () => pending.promise });
  let tree = await context.page.flush({});
  assert.ok(text(tree).includes('Edit profile'));
  assert.equal(input(tree, 'username').props.value, user.username);
  tree = await edit(context, tree, { username: '我的名字' });
  const work = submit(tree); await new Promise(setImmediate);
  context.localeStore.useLocaleStore.getState().setLocale('zh-CN');
  pending.reject({ response: { data: { error: '用户名已被使用' } } }); await work;
  tree = await context.page.flush(); assert.ok(text(tree).includes('用户名已被使用'));
  context.localeStore.useLocaleStore.getState().setLocale('en');
  tree = await context.page.flush(); assert.ok(text(tree).includes('This username is already taken'));
  assert.equal(input(tree, 'username').props.value, '我的名字');
});

test('invalid editable values cannot reach the API and remain available for correction', async () => {
  const cases = [
    ['username', '  ', '用户名必须'], ['username', 'x'.repeat(51), '用户名必须'],
    ['phone', 'x'.repeat(21), '联系电话必须'],
    ['avatar_url', '/image.png', '头像地址必须'], ['avatar_url', 'javascript:alert(1)', '头像地址必须'],
    ['avatar_url', 'ftp://example.test/photo.png', '头像地址必须'], ['avatar_url', 'https://example.test/a b', '头像地址必须'],
    ['avatar_url', 'https://example.test/' + 'x'.repeat(255), '头像地址必须'],
  ];
  for (const [name, value, message] of cases) {
    const context = settings(); let tree = await context.page.flush({});
    tree = await edit(context, tree, { [name]: value });
    await submit(tree); tree = await context.page.flush();
    assert.equal(context.requests.filter(request => request.method === 'put').length, 0);
    assert.ok(text(tree).includes(message), name);
    assert.equal(input(tree, name).props.value, value);
  }
  const context = settings(); let tree = await context.page.flush({});
  const prefix = 'https://example.test/';
  tree = await edit(context, tree, { username: '单', phone: 'a'.repeat(20), avatar_url: prefix + 'a'.repeat(255 - prefix.length) });
  await submit(tree); tree = await context.page.flush();
  assert.equal(context.requests[1].body.avatar_url.length, 255);
  assert.ok(text(tree).includes('资料已保存'));
});

test('no profile request runs before hydration or when signed out', async () => {
  const context = settings(); context.useAuthStore.setState({ isHydrated: false });
  await context.page.flush({}); assert.deepEqual(context.requests, []);
  context.useAuthStore.getState().logout(); await context.page.flush();
  assert.deepEqual(context.requests, []); assert.deepEqual(context.page.redirects, ['/login']);
});

test('previous load successes and failures cannot reveal another customer details', async () => {
  for (const outcome of ['success', 'failure']) {
    const pending = deferred(); let attempts = 0;
    const second = { ...user, user_id: 2, username: 'second', email: 'second@example.test' };
    const context = settings({ getProfile: () => ++attempts === 1 ? pending.promise : Promise.resolve({ user: second }) });
    await context.page.flush({});
    context.useAuthStore.getState().login(second, 'session-two');
    const firstRender = await context.page.render({});
    assert.equal(findElements(firstRender, element => element.props.name === 'username').length, 0);
    let tree = await context.page.flush(); assert.equal(input(tree, 'username').props.value, 'second');
    if (outcome === 'success') pending.resolve({ user }); else pending.reject(new Error('previous error'));
    await new Promise(setImmediate); tree = await context.page.flush();
    assert.equal(input(tree, 'username').props.value, 'second');
    assert.equal(context.useAuthStore.getState().user.user_id, 2);
    assert.equal(JSON.parse(context.localStorage.getItem('user')).username, 'second');
    assert.equal(findElements(tree, element => element.props.role === 'alert').length, 0);
  }
});

test('previous save successes and failures do not clear the new customer pending save', async () => {
  for (const outcome of ['success', 'failure']) {
    const old = deferred(), next = deferred();
    const second = { ...user, user_id: 2, username: 'second', email: 'second@example.test' };
    let saves = 0;
    const context = settings({ getProfile: config => Promise.resolve({ user: config.headers.get('Authorization') === 'Bearer session-one' ? user : second }),
      save: () => ++saves === 1 ? old.promise : next.promise });
    let tree = await context.page.flush({}); tree = await edit(context, tree, { username: 'old write' });
    const work = submit(tree); await new Promise(setImmediate);
    context.useAuthStore.getState().login(second, 'session-two');
    tree = await context.page.flush(); tree = await edit(context, tree, { username: 'new write' });
    const currentWork = submit(tree); await new Promise(setImmediate);
    if (outcome === 'success') old.resolve({ user: { ...user, username: 'old write' } });
    else old.reject({ response: { data: { error: '用户名已被使用' } } });
    await work; tree = await context.page.flush();
    assert.equal(input(tree, 'username').props.value, 'new write');
    assert.equal(button(tree, '保存中...').props.disabled, true);
    assert.equal(context.useAuthStore.getState().user.username, 'second');
    next.resolve({ user: { ...second, username: 'new write' } }); await currentWork;
    tree = await context.page.flush(); assert.equal(input(tree, 'username').props.value, 'new write');
    assert.ok(text(tree).includes('资料已保存'));
    assert.equal(JSON.parse(context.localStorage.getItem('user')).username, 'new write');
  }
});

test('leaving settings ignores pending reads and writes without changing stored details', async () => {
  for (const action of ['load', 'save']) {
    const pending = deferred(); const context = settings({ getProfile: () => action === 'load' ? pending.promise : Promise.resolve({ user }), save: () => pending.promise });
    let tree = await context.page.flush({}); let work;
    if (action === 'save') { tree = await edit(context, tree, { username: 'leave write' }); work = submit(tree); await new Promise(setImmediate); }
    const before = context.localStorage.getItem('user'); context.page.unmount();
    pending.resolve({ user: { ...user, username: 'late details' } }); if (work) await work;
    await new Promise(setImmediate);
    assert.equal(context.localStorage.getItem('user'), before);
    assert.equal(context.useAuthStore.getState().user.username, user.username);
  }
});

test('stale form actions cannot submit using changed browser credentials before hydration catches up', async () => {
  const context = settings(); let tree = await context.page.flush({}); tree = await edit(context, tree, { username: 'draft' });
  context.localStorage.setItem('token', 'session-two');
  await submit(tree);
  assert.deepEqual(context.requests.map(request => request.method), ['get']);
  const hidden = await context.page.render();
  assert.equal(findElements(hidden, element => element.type === 'form').length, 0);
});

test('profile responses for a different customer are rejected for both read and save', async () => {
  for (const action of ['load', 'save']) {
    const wrong = { ...user, user_id: 2, username: 'private second' };
    const context = settings({ getProfile: async () => ({ user: action === 'load' ? wrong : user }), save: async () => ({ user: wrong }) });
    let tree = await context.page.flush({});
    if (action === 'save') { tree = await edit(context, tree, { username: 'new' }); await submit(tree); tree = await context.page.flush(); }
    assert.ok(text(tree).includes('用户资料响应无效'));
    assert.ok(!text(tree).includes('private second'));
    assert.equal(context.useAuthStore.getState().user.username, user.username);
  }
});

test('a profile storage failure cannot publish state that disappears on refresh', () => {
  const context = loadStores(); context.useAuthStore.getState().login(user, 'session-one');
  const before = context.useAuthStore.getState().user;
  context.localStorage.setItem = () => { throw new Error('storage full'); };
  assert.equal(context.useAuthStore.getState().updateUser({ username: 'unpersisted' }, 'session-one'), false);
  assert.deepEqual(context.useAuthStore.getState().user, before);
});

test('profile displays the saved avatar and recovers with a default icon if the URL fails', async () => {
  const context = loadStores(); context.useAuthStore.getState().login(user, 'session-one');
  const page = loadPage('src/app/profile/page.tsx', { globals: context, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => context.useAuthStore.getState(), { getState: context.useAuthStore.getState }) },
    '@/lib/api': { userApi: { getStats: async () => ({ stats: { totalOrders: 0, pendingOrders: 0, totalCoupons: 0, availableCoupons: 0, favoriteCount: 0 } }) } },
  } });
  let tree = await page.flush({});
  const avatar = findElements(tree, element => element.props.src === user.avatar_url)[0];
  assert.ok(avatar, 'the personal center should display the saved avatar');
  assert.equal(avatar.props.alt, '用户头像');
  assert.ok(text(tree).includes(user.phone));
  avatar.props.onError(); tree = await page.flush();
  assert.equal(findElements(tree, element => element.props.src === user.avatar_url).length, 0);
  context.useAuthStore.getState().updateUser({ avatar_url: 'https://example.test/new.png' }, 'session-one');
  tree = await page.flush();
  assert.equal(findElements(tree, element => element.props.src === 'https://example.test/new.png').length, 1);
});

test('a locally unsynced save offers reload without falsely reporting success', async () => {
  const context = settings(); let tree = await context.page.flush({});
  tree = await edit(context, tree, { username: 'saved remotely' });
  context.localStorage.setItem = () => { throw new Error('storage full'); };
  await submit(tree); tree = await context.page.flush();
  assert.ok(text(tree).includes('资料已保存，但本地同步失败'));
  assert.ok(button(tree, '重新加载资料'));
  assert.equal(findElements(tree, element => element.props.role === 'status').length, 0);
  assert.equal(context.useAuthStore.getState().user.username, user.username);
});

test('only the latest reload can populate settings for the same customer', async () => {
  const old = deferred(), current = deferred(); let calls = 0;
  const context = settings({ getProfile: () => ++calls === 1 ? Promise.reject(new Error('offline')) : calls === 2 ? old.promise : current.promise });
  let tree = await context.page.flush({});
  const reload = button(tree, '重新加载资料').props.onClick;
  const first = reload(), second = reload(); await new Promise(setImmediate);
  current.resolve({ user: { ...user, username: 'latest details' } }); await second;
  tree = await context.page.flush(); assert.equal(input(tree, 'username').props.value, 'latest details');
  old.resolve({ user: { ...user, username: 'obsolete details' } }); await first;
  tree = await context.page.flush();
  assert.equal(input(tree, 'username').props.value, 'latest details');
  assert.equal(JSON.parse(context.localStorage.getItem('user')).username, 'latest details');
});
