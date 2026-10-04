const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi, loadSource, loadPage, findElements } = require('./runtime.cjs');

function registration({ locale = 'en', rejectMessage } = {}) {
  const browser = loadApi({});
  const localeStore = loadSource('src/store/useLocaleStore.ts', browser);
  localeStore.useLocaleStore.getState().setLocale(locale);
  const i18n = loadSource('src/lib/i18n.ts', browser, { '@/store/useLocaleStore': localeStore });
  const sent = [];
  const errors = [];
  browser.default.defaults.adapter = async config => {
    sent.push({ url: config.url, body: JSON.parse(config.data) });
    if (rejectMessage) throw { response: { data: { error: rejectMessage } } };
    return { data: { user: { user_id: 1, username: 'Customer', email: 'customer@example.test' }, token: 'new-session' },
      status: 201, statusText: 'Created', headers: {}, config };
  };
  const page = loadPage('src/app/register/page.tsx', {
    globals: { ...browser, TextEncoder },
    imports: {
      '@/lib/api': browser,
      '@/lib/i18n': { ...i18n, useI18n: () => ({ t: i18n.translate, locale: localeStore.useLocaleStore.getState().locale }) },
      'react-hot-toast': { __esModule: true, default: { error: message => errors.push(message), success() {} } },
    },
  });
  const auth = browser.useAuthStore.getState();
  return { browser, page, auth, sent, errors, i18n, localeStore };
}

async function fill(context, fields) {
  let tree = await context.page.render(context.auth);
  for (const [name, value] of Object.entries(fields)) {
    findElements(tree, element => element.type === 'input' && element.props.name === name)[0].props.onChange({ target: { name, value } });
    tree = await context.page.render(context.auth);
  }
  return tree;
}

function submit(tree) {
  return findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
}

test('registration explains the UTF-8 password limit before sending a too-long multibyte password', async () => {
  const context = registration();
  const password = '汉'.repeat(25);
  assert.equal(Buffer.byteLength(password, 'utf8'), 75);
  const tree = await fill(context, { username: 'Customer', email: 'customer@example.test', password, confirmPassword: password });
  await submit(tree);
  assert.equal(context.sent.length, 0);
  assert.equal(context.errors.length, 1);
  assert.match(context.errors[0], /72.*UTF-8|UTF-8.*72/);
  assert.doesNotMatch(context.errors[0], /[\u4e00-\u9fff]/);
  assert.equal(context.page.redirects.length, 0);
});

test('registration trims account fields, allows a one-character username and preserves password whitespace', async () => {
  const context = registration();
  const password = '  密码123 ';
  const tree = await fill(context, { username: '  单  ', email: '  customer@example.test  ', password, confirmPassword: password });
  assert.equal(findElements(tree, element => element.props.name === 'username')[0].props.maxLength, 50);
  assert.equal(findElements(tree, element => element.props.name === 'email')[0].props.maxLength, 100);
  assert.equal(findElements(tree, element => element.props.name === 'password')[0].props.minLength, 6);
  await submit(tree);
  assert.equal(context.sent.length, 1);
  assert.deepEqual(context.sent[0].body, { username: '单', email: 'customer@example.test', password });
  assert.equal(context.errors.length, 0);
  assert.equal(context.browser.useAuthStore.getState().token, 'new-session');
  assert.deepEqual(context.page.redirects, ['/']);
});

test('registration displays the account validator failure in the chosen language without signing in', async () => {
  for (const locale of ['en', 'zh-CN']) {
    const message = '用户名必须为1至50个字符';
    const context = registration({ locale, rejectMessage: message });
    const tree = await fill(context, { username: 'Customer', email: 'customer@example.test', password: 'valid-password', confirmPassword: 'valid-password' });
    await submit(tree);
    assert.equal(context.sent.length, 1);
    assert.equal(context.errors[0], locale === 'en' ? 'Username must contain 1 to 50 characters' : message);
    assert.equal(context.browser.useAuthStore.getState().isAuthenticated, false);
    assert.equal(context.page.redirects.length, 0);
  }
});

test('account validation errors translate exact system messages while unknown content stays literal', () => {
  const { translate } = loadSource('src/lib/i18n.ts');
  const cases = [
    ['邮箱格式无效或超过100个字符', /email.*100/i],
    ['密码必须为字符串', /password.*string/i],
    ['注册字段或值无效', /registration.*fields/i],
    ['登录字段或值无效', /sign-in.*fields/i],
    ['个人资料字段或值无效', /profile.*fields/i],
    ['请至少提供一项个人资料修改', /at least one.*profile/i],
    ['联系电话必须为不超过20个字符的字符串或空值', /phone.*20/i],
    ['头像地址必须为不超过255个字符的HTTP(S)网址或空值', /avatar.*255.*HTTP/i],
    ['用户名或邮箱已被使用', /username.*email.*already/i],
  ];
  for (const [message, expected] of cases) {
    assert.match(translate(message, {}, 'en'), expected, message);
    assert.doesNotMatch(translate(message, {}, 'en'), /[\u4e00-\u9fff]/, message);
    assert.equal(translate(message, {}, 'zh-CN'), message);
  }
  const original = '原始商品名：邮箱格式无效或超过100个字符 $& {count}';
  assert.equal(translate(original, {}, 'en'), original);
});

test('review validation and duplicate errors use the selected language', () => {
  const { translate } = loadSource('src/lib/i18n.ts');
  const cases = [
    ['评论参数或字段无效', /invalid.*review/i],
    ['用户或商品或订单ID无效', /invalid.*user.*product.*order/i],
    ['该商品不属于此订单', /product.*not.*order/i],
    ['评论已存在，请勿重复提交', /review.*already.*resubmit/i],
  ];
  for (const [message, expected] of cases) {
    assert.match(translate(message, {}, 'en'), expected);
    assert.equal(translate(message, {}, 'zh-CN'), message);
  }
  const content = '我的评论已存在，请勿重复提交？这个商品不错。';
  assert.equal(translate(content, {}, 'en'), content);
});
