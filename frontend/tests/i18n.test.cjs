const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource, createBrowser, loadPage, findElements } = require('./runtime.cjs');

function setup(storage = {}) {
  const browser = createBrowser(storage);
  const store = loadSource('src/store/useLocaleStore.ts', browser);
  const i18n = loadSource('src/lib/i18n.ts', browser, { '@/store/useLocaleStore': store });
  return { ...browser, ...store, ...i18n };
}

test('language hydrates independently of authentication and persists across a new store', () => {
  const first = setup({ 'ecommerce-locale': 'en', token: 'customer-session' });
  assert.equal(first.useLocaleStore.getState().locale, 'zh-CN');
  first.useLocaleStore.getState().hydrate();
  assert.equal(first.useLocaleStore.getState().locale, 'en');
  first.useLocaleStore.getState().setLocale('zh-CN');
  assert.equal(first.localStorage.getItem('ecommerce-locale'), 'zh-CN');
  assert.equal(first.localStorage.getItem('token'), 'customer-session');
  const second = setup({ 'ecommerce-locale': first.localStorage.getItem('ecommerce-locale') });
  second.useLocaleStore.getState().hydrate();
  assert.equal(second.useLocaleStore.getState().locale, 'zh-CN');
});

test('invalid, removed or inaccessible preferences safely fall back to Chinese', () => {
  const app = setup({ 'ecommerce-locale': '<invalid>' });
  app.useLocaleStore.getState().hydrate();
  assert.equal(app.useLocaleStore.getState().locale, 'zh-CN');
  app.useLocaleStore.getState().setLocale('en');
  app.localStorage.removeItem('ecommerce-locale');
  app.useLocaleStore.getState().hydrate();
  assert.equal(app.useLocaleStore.getState().locale, 'zh-CN');
  app.localStorage.getItem = () => { throw new Error('blocked'); };
  app.localStorage.setItem = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => app.useLocaleStore.getState().hydrate());
  assert.doesNotThrow(() => app.useLocaleStore.getState().setLocale('en'));
  assert.equal(app.useLocaleStore.getState().locale, 'en');
});

test('translations interpolate values literally and react to language changes', () => {
  const app = setup();
  assert.equal(app.translate('登录'), '登录');
  app.useLocaleStore.getState().setLocale('en');
  assert.equal(app.translate('登录'), 'Sign in');
  assert.equal(app.translate('搜索结果: {keyword}', { keyword: '中文 $& <script>' }), 'Search results: 中文 $& <script>');
  assert.equal(app.translate('Original user content 中文'), 'Original user content 中文');
  app.useLocaleStore.getState().setLocale('zh-CN');
  assert.equal(app.translate('搜索结果: {keyword}', { keyword: '手机' }), '搜索结果: 手机');
});

test('date formatting follows the selected locale and handles missing dates', () => {
  const app = setup();
  const date = '2026-10-02T10:20:00Z';
  assert.equal(app.formatDate(date, true), new Date(date).toLocaleDateString('zh-CN'));
  app.useLocaleStore.getState().setLocale('en');
  assert.equal(app.formatDate(date, true), new Date(date).toLocaleDateString('en-US'));
  assert.equal(app.formatDate(null), '—');
  assert.equal(app.formatDate('invalid'), '—');
});

test('language control switches the shared preference without navigation', async () => {
  const app = setup();
  const page = loadPage('src/components/LanguageSwitcher.tsx', { imports: {
    '@/lib/i18n': { useI18n: () => ({ locale: app.useLocaleStore.getState().locale, t: app.translate }) },
    '@/store/useLocaleStore': { useLocaleStore: (selector) => selector(app.useLocaleStore.getState()) },
  } });
  let tree = await page.render();
  const select = findElements(tree, (element) => element.type === 'select')[0];
  assert.equal(select.props.value, 'zh-CN');
  select.props.onChange({ target: { value: 'en' } });
  tree = await page.render();
  assert.equal(findElements(tree, (element) => element.type === 'select')[0].props.value, 'en');
  assert.equal(app.localStorage.getItem('ecommerce-locale'), 'en');
  assert.equal(page.redirects.length, 0);
});

function i18nImport(app) {
  return { ...app, useI18n: () => ({ locale: app.useLocaleStore.getState().locale, t: app.translate, formatDate: app.formatDate }) };
}

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (tree && typeof tree === 'object') return textContent(tree.props?.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}

test('changing login language preserves entered values and translates server failures', async () => {
  const app = setup();
  const messages = [];
  const payloads = [];
  const page = loadPage('src/app/login/page.tsx', { imports: {
    '@/lib/i18n': i18nImport(app),
    '@/lib/api': { userApi: { login: async (payload) => { payloads.push(payload); throw { response: { data: { error: '邮箱或密码错误' } } }; } } },
    'react-hot-toast': { __esModule: true, default: { error: (message) => messages.push(message), success() {} } },
  } });
  const auth = { login() {} };
  let tree = await page.render(auth);
  assert.match(textContent(tree), /登录账号/);
  for (const [type, value] of [['email', 'customer@example.test'], ['password', 'example-password']]) {
    findElements(tree, (element) => element.type === 'input' && element.props.type === type)[0].props.onChange({ target: { value } });
  }
  app.useLocaleStore.getState().setLocale('en');
  tree = await page.render(auth);
  assert.match(textContent(tree), /Sign in to your account/);
  assert.equal(findElements(tree, (element) => element.props.type === 'email')[0].props.value, 'customer@example.test');
  assert.equal(findElements(tree, (element) => element.props.type === 'password')[0].props.value, 'example-password');
  await findElements(tree, (element) => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(payloads[0].email, 'customer@example.test');
  assert.equal(payloads[0].password, 'example-password');
  assert.match(messages[0], /email|password/i);
  assert.doesNotMatch(messages[0], /[\u4e00-\u9fff]/);
  app.useLocaleStore.getState().setLocale('zh-CN');
  assert.match(textContent(await page.render(auth)), /登录账号/);
});

test('server error templates preserve product names and literal replacement characters', () => {
  const app = setup();
  app.useLocaleStore.getState().setLocale('en');
  const result = app.translate('商品 中文 $& {count} 库存不足');
  assert.match(result, /中文 \$& \{count\}/);
  assert.doesNotMatch(result, /库存不足/);
  assert.match(app.translate('商品 123 不存在或已下架'), /123/);
  assert.doesNotMatch(app.translate('商品 123 不存在或已下架'), /不存在/);
});

test('app shell synchronizes html language and cross-tab preference changes without changing sessions', async () => {
  const app = setup({ 'ecommerce-locale': 'en', token: 'customer-session' });
  const listeners = new Map();
  const auth = { hydrate() {} };
  const document = { title: '', documentElement: { lang: 'zh-CN' } };
  const localeHook = Object.assign((selector) => selector(app.useLocaleStore.getState()), { getState: app.useLocaleStore.getState });
  const page = loadPage('src/components/AppShell.tsx', { globals: {
    ...app, document, window: {
      addEventListener: (name, fn) => { const entries = listeners.get(name) || []; entries.push(fn); listeners.set(name, entries); },
      removeEventListener: (name, fn) => listeners.set(name, listeners.get(name).filter((item) => item !== fn)),
    },
  }, imports: {
    '@/components/Header': () => null,
    '@/components/SiteFooter': () => null,
    'react-hot-toast': { Toaster: () => null },
    'next/navigation': { usePathname: () => '/' },
    '@/lib/i18n': i18nImport(app),
    '@/store/useLocaleStore': { useLocaleStore: localeHook, LOCALE_STORAGE_KEY: app.LOCALE_STORAGE_KEY },
  } });
  await page.render(auth);
  assert.equal(document.documentElement.lang, 'zh-CN');
  await page.render(auth);
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Shop');
  app.localStorage.setItem('ecommerce-locale', 'zh-CN');
  listeners.get('storage').forEach((fn) => fn({ storageArea: app.localStorage, key: 'ecommerce-locale' }));
  await page.render(auth);
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(app.localStorage.getItem('token'), 'customer-session');
  page.unmount();
  assert.equal(listeners.get('storage').length, 0);
});

test('visible UI literals and translation placeholders are covered by the dictionaries', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const dictionaries = Object.assign({}, ...['error', 'account', 'admin', 'common'].map((name) => loadSource(`src/lib/${name}-translations.ts`)[`${name}Translations`]));
  function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? files(file) : file.endsWith('.tsx') ? [file] : [];
    });
  }
  for (const filename of files(path.join(__dirname, '../src'))) {
    const sf = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 't' && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        assert.ok(Object.hasOwn(dictionaries, key), `${filename}: untranslated key ${key}`);
      }
      if (ts.isJsxText(node) && /[\u4e00-\u9fff]/.test(node.text)) {
        assert.equal(path.basename(filename), 'LanguageSwitcher.tsx', `${filename}: untranslated UI text ${node.text.trim()}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  for (const [key, english] of Object.entries(dictionaries)) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(english), placeholders(key), `Placeholder mismatch: ${key}`);
  }
});

test('favorites and history preserve real names of deleted products in both languages', async () => {
  for (const collection of ['favorites', 'history']) {
    const app = setup();
    const rows = [
      { product_id: 1, favorite_id: 1, id: 1, title: '原有商品名', status: -1, stock: 0, price: 80 },
      { product_id: 2, favorite_id: 2, id: 2, title: '商品已不存在', status: -1, stock: 0, price: 0 },
    ];
    const page = loadPage(`src/app/${collection}/page.tsx`, { imports: {
      '@/lib/i18n': i18nImport(app),
      '@/hooks/use-customer-activity': {
        canBuyActivityProduct: () => false,
        useCustomerActivity: () => ({ user: { user_id: 1 }, isHydrated: true, rows, loading: false,
          page: 1, total: 2, totalPages: 1, limit: 20, busy: false }),
      },
    } });
    assert.match(textContent(await page.render()), /原有商品名/);
    app.useLocaleStore.getState().setLocale('en');
    const text = textContent(await page.render());
    assert.match(text, /原有商品名/);
    assert.match(text, /Product no longer available/);
    assert.doesNotMatch(text, /商品已不存在/);
  }
});

test('coupon language changes percentage presentation without refetching or rewriting coupon data', async () => {
  for (const route of ['coupons', 'my/coupons', 'admin/coupons']) {
    const app = setup();
    const coupon = { coupon_id: 1, user_coupon_id: 7, name: '原始中文券名', code: 'EXAMPLE20', type: 2,
      discount_value: '20.00', min_amount: 0, max_discount: '50.00', total_quantity: 10, remain_quantity: 5,
      per_user_limit: 1, status: 1, coupon_status: 1, received_at: '2026-01-01T00:00:00Z',
      start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z' };
    let loads = 0;
    const load = async () => { loads++; return { data: [coupon] }; };
    const page = loadPage(`src/app/${route}/page.tsx`, { imports: {
      '@/lib/i18n': i18nImport(app),
      '@/lib/api': { couponApi: { getAvailable: load, getMyCoupons: load }, adminCouponApi: { getList: load } },
      '@/components/AdminLayout': ({ children }) => children,
    } });
    const auth = { isHydrated: true, isAuthenticated: true, user: { user_id: 1 } };
    assert.match(textContent(await page.flush(auth)), /8折/);
    const count = loads;
    app.useLocaleStore.getState().setLocale('en');
    const text = textContent(await page.flush(auth));
    assert.match(text, /20% off/);
    assert.doesNotMatch(text, /8折|80% off/);
    assert.match(text, /原始中文券名/);
    assert.equal(loads, count);
    assert.equal(coupon.discount_value, '20.00');
  }
});

test('sales chart calendar groups keep their UTC date while order timestamps use local time', async () => {
  const app = setup();
  const calls = [];
  const page = loadPage('src/app/admin/dashboard/page.tsx', { initialState: {
    0: {}, 1: [], 2: [], 3: [{ date: '2026-10-02T00:00:00.000Z', revenue: 80, order_count: 1 }], 4: false, 5: true,
  }, imports: {
    '@/components/AdminLayout': ({ children }) => children,
    '@/lib/i18n': { useI18n: () => ({ t: app.translate, formatDate: (...args) => { calls.push(args); return app.formatDate(...args); } }) },
  } });
  app.useLocaleStore.getState().setLocale('en');
  const tree = await page.render();
  const axis = findElements(tree, (element) => typeof element.props.tickFormatter === 'function')[0];
  const tooltip = findElements(tree, (element) => typeof element.props.labelFormatter === 'function')[0];
  for (const value of ['2026-10-02', '2026-10-02T00:00:00.000Z']) {
    assert.equal(axis.props.tickFormatter(value), '10/2/2026');
    assert.equal(tooltip.props.labelFormatter(value), '10/2/2026');
  }
  assert.ok(calls.every((call) => call[2]?.timeZone === 'UTC'));
  assert.equal(app.formatDate('2026-10-02T00:00:00.000Z'), new Date('2026-10-02T00:00:00.000Z').toLocaleString('en-US'));
});
