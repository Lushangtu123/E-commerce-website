const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi, loadSource, loadPage, findElements } = require('./runtime.cjs');
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const products = [{ item_id: 1, product_id: 11, product_name: '中文原始商品', sku_id: 1, price: 10, quantity: 1 }, { item_id: 2, product_id: 11, product_name: '中文原始商品', sku_id: 2, price: 10, quantity: 1 }, { item_id: 3, product_id: 12, product_name: '另一商品', price: 10, quantity: 1 }];
const forms = tree => findElements(tree, element => element.type === 'form');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const savedReview = (product_id = 11, content = '已保存的原文', user_id = 1, order_id = 7) => ({ review_id: product_id, product_id, user_id, order_id, rating: 4, content, created_at: '2026-10-04T10:00:00Z' });
const submit = form => form.props.onSubmit({ preventDefault() {} });

function reviews({ list = async () => ({ reviews: [], totalPages: 0 }), save = async () => ({ review_id: 99 }), locale = 'zh-CN', items = products } = {}) {
  const browser = loadApi({ token: 'buyer-one' });
  const localeStore = loadSource('src/store/useLocaleStore.ts', browser);
  localeStore.useLocaleStore.getState().setLocale(locale);
  const i18n = loadSource('src/lib/i18n.ts', browser, { '@/store/useLocaleStore': localeStore });
  const requests = [];
  browser.default.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, params: config.params, body, authorization: config.headers.get('Authorization') });
    const data = config.method === 'get' ? await list(config.params) : await save(body);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const props = { orderId: 7, items };
  const page = loadPage('src/components/OrderReviews.tsx', { props, globals: browser, imports: {
    '@/lib/api': browser,
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => browser.useAuthStore.getState(), { getState: browser.useAuthStore.getState }) },
    '@/lib/i18n': { ...i18n, useI18n: () => ({ t: i18n.translate, formatDate: i18n.formatDate }) },
  } });
  return { ...browser, page, requests, props, localeStore };
}

test('completed purchase review forms deduplicate SKUs and submit only the selected purchased product', async () => {
  const context = reviews();
  let tree = await context.page.flush({});
  assert.equal(forms(tree).length, 2);
  const form = forms(tree)[0];
  findElements(form, element => element.type === 'select')[0].props.onChange({ target: { value: '4' } });
  findElements(form, element => element.type === 'textarea')[0].props.onChange({ target: { value: '  实际评价内容  ' } });
  tree = await context.page.flush();
  await forms(tree)[0].props.onSubmit({ preventDefault() {} });
  tree = await context.page.flush();
  assert.deepEqual(context.requests[0].params, { order_id: 7, page: 1, limit: 100 });
  assert.deepEqual(context.requests[1], { method: 'post', url: '/reviews', params: undefined, authorization: 'Bearer buyer-one', body: { order_id: 7, product_id: 11, rating: 4, content: '实际评价内容' } });
  assert.equal(forms(tree).length, 1);
  assert.ok(text(tree).includes('实际评价内容'));
  assert.ok(text(tree).includes('已评价'));
});

test('order detail exposes the review section only for a completed order', async () => {
  const Marker = () => null;
  for (const status of [0, 1, 2, 3, 4]) {
    const page = loadPage('src/app/orders/[id]/page.tsx', { globals: { setInterval: () => 1, clearInterval() {} }, imports: {
      '@/components/OrderReviews': { __esModule: true, default: Marker },
      '@/lib/api': { orderApi: { getDetail: async () => ({ order: { status, total_amount: 10 }, items: products }) }, orderTimeoutApi: { getRemainingTime: async () => ({ remaining_minutes: 10 }) } },
    } });
    const tree = await page.flush({ isHydrated: true, isAuthenticated: true, user: { user_id: 1 } });
    const sections = findElements(tree, element => element.type === Marker);
    assert.equal(sections.length, status === 3 ? 1 : 0);
    if (status === 3) { assert.equal(sections[0].props.orderId, 1); assert.equal(sections[0].props.items, products); }
  }
});

test('review labels and saved system status switch to English while buyer text remains literal', async () => {
  const context = reviews({ locale: 'en' });
  let tree = await context.page.flush({});
  assert.ok(text(tree).includes('Order reviews'));
  assert.ok(text(tree).includes('中文原始商品'));
  await forms(tree)[0].props.onSubmit({ preventDefault() {} });
  tree = await context.page.flush();
  assert.ok(text(tree).includes('Reviewed'));
  assert.ok(text(tree).includes('Review submitted successfully'));
});

test('all pages of the current order are loaded before any review form becomes available', async () => {
  const items = Array.from({ length: 101 }, (_, index) => ({ product_id: index + 1, product_name: `商品${index + 1}` }));
  const last = deferred();
  const context = reviews({ items, list: ({ page }) => page === 1 ? { reviews: items.slice(0, 100).map(item => savedReview(item.product_id)), totalPages: 2 } : last.promise });
  let tree = await context.page.flush({});
  assert.equal(forms(tree).length, 0);
  assert.ok(text(tree).includes('订单评价加载中...'));
  last.resolve({ reviews: [savedReview(101, '第二页已有评价')], totalPages: 2 });
  await new Promise(setImmediate); tree = await context.page.flush();
  assert.equal(forms(tree).length, 0);
  assert.ok(text(tree).includes('第二页已有评价'));
  assert.deepEqual(context.requests.map(request => request.params), [{ order_id: 7, page: 1, limit: 100 }, { order_id: 7, page: 2, limit: 100 }]);
});

test('failed loads and malformed or foreign review responses expose retry instead of a false empty state', async () => {
  for (const failure of [new Error('offline'), { reviews: [savedReview(11, '他人秘密', 2)], totalPages: 1 }, { reviews: [savedReview(11, '其他订单', 1, 8)], totalPages: 1 }, { reviews: [], totalPages: 9 }, { reviews: [savedReview(99)], totalPages: 1 }]) {
    let count = 0;
    const context = reviews({ list: async () => {
      if (++count > 1) return { reviews: [savedReview()], totalPages: 1 };
      if (failure instanceof Error) throw failure;
      return failure;
    } });
    let tree = await context.page.flush({});
    assert.equal(forms(tree).length, 0); assert.ok(text(tree).includes('加载订单评价失败，请重试'));
    assert.ok(!text(tree).includes('他人秘密')); assert.ok(!text(tree).includes('其他订单'));
    await button(tree, '重新加载评价').props.onClick(); tree = await context.page.flush();
    assert.ok(text(tree).includes('已保存的原文')); assert.equal(forms(tree).length, 1);
  }
});

test('a pending save blocks repeated submissions and every other product while preserving its draft on failure', async () => {
  const pending = deferred();
  const context = reviews({ save: () => pending.promise });
  let tree = await context.page.flush({});
  findElements(forms(tree)[0], element => element.type === 'textarea')[0].props.onChange({ target: { value: '需要保留的草稿' } });
  tree = await context.page.flush();
  const before = forms(tree);
  const saving = submit(before[0]);
  await submit(before[0]); await submit(before[1]);
  tree = await context.page.flush();
  assert.equal(context.requests.filter(request => request.method === 'post').length, 1);
  assert.ok(findElements(tree, element => ['select', 'textarea', 'button'].includes(element.type)).every(element => element.props.disabled));
  context.localeStore.useLocaleStore.getState().setLocale('en');
  pending.reject({ response: { status: 500, data: { error: '创建评论失败' } } });
  await saving; tree = await context.page.flush();
  assert.ok(text(tree).includes('Unable to submit your review'));
  assert.equal(findElements(forms(tree)[0], element => element.type === 'textarea')[0].props.value, '需要保留的草稿');
  assert.equal(button(tree, 'Submit review').props.disabled, false);
});

test('a concurrent duplicate reloads the canonical saved review and survives remount', async () => {
  let count = 0;
  const context = reviews({ list: async () => ({ reviews: ++count > 1 ? [savedReview(11, '服务器已存在评价')] : [], totalPages: count > 1 ? 1 : 0 }), save: async () => { throw { response: { status: 409, data: { error: '评论已存在，请勿重复提交' } } }; } });
  let tree = await context.page.flush({});
  await submit(forms(tree)[0]); tree = await context.page.flush();
  assert.ok(text(tree).includes('服务器已存在评价')); assert.equal(forms(tree).length, 1);
  assert.ok(text(tree).includes('评论已存在，请勿重复提交'));
  const refreshed = reviews({ list: async () => ({ reviews: [savedReview(11, '服务器已存在评价')], totalPages: 1 }) });
  tree = await refreshed.page.flush({});
  assert.equal(forms(tree).length, 1); assert.ok(text(tree).includes('服务器已存在评价'));
});

test('rating and content limits reject invalid drafts and permit the 2000 character boundary', async () => {
  const context = reviews();
  let tree = await context.page.flush({});
  for (const [rating, content] of [['6', ''], ['2.5', ''], ['01', ''], ['5', 'x'.repeat(2001)]]) {
    findElements(forms(tree)[0], element => element.type === 'select')[0].props.onChange({ target: { value: rating } });
    findElements(forms(tree)[0], element => element.type === 'textarea')[0].props.onChange({ target: { value: content } });
    tree = await context.page.flush(); await submit(forms(tree)[0]); tree = await context.page.flush();
    assert.ok(text(tree).includes('评分须为1至5分')); assert.equal(context.requests.filter(request => request.method === 'post').length, 0);
  }
  findElements(forms(tree)[0], element => element.type === 'select')[0].props.onChange({ target: { value: '1' } });
  findElements(forms(tree)[0], element => element.type === 'textarea')[0].props.onChange({ target: { value: '中'.repeat(2000) } });
  tree = await context.page.flush(); await submit(forms(tree)[0]);
  assert.equal(context.requests[1].body.content.length, 2000); assert.equal(context.requests[1].body.rating, 1);
});

test('unhydrated, signed out, empty purchases and unavailable browser storage never request private reviews', async () => {
  for (const scenario of ['hydration', 'logout', 'empty', 'storage']) {
    const context = reviews({ items: scenario === 'empty' ? [] : products });
    if (scenario === 'hydration') context.useAuthStore.setState({ isHydrated: false });
    if (scenario === 'logout') context.useAuthStore.getState().logout();
    if (scenario === 'storage') context.localStorage.getItem = () => { throw new Error('blocked'); };
    const tree = await context.page.flush({});
    assert.equal(tree, null); assert.equal(context.requests.length, 0);
  }
});

test('late reads cannot reveal a prior customer, token or order and stale form actions cannot submit', async () => {
  for (const scenario of ['account', 'token', 'order', 'storage', 'storage-user', 'unmount']) {
    const old = deferred(); let calls = 0;
    const context = reviews({ list: () => ++calls === 1 ? old.promise : Promise.resolve({ reviews: [], totalPages: 0 }) });
    await context.page.flush({});
    if (scenario === 'account') context.useAuthStore.getState().login({ user_id: 2, username: 'two', email: 'two@example.test' }, 'buyer-two');
    if (scenario === 'token') context.useAuthStore.getState().login(context.useAuthStore.getState().user, 'renewed');
    if (scenario === 'order') context.props.orderId = 8;
    if (scenario === 'storage') context.localStorage.setItem('token', 'different');
    if (scenario === 'storage-user') context.localStorage.setItem('user', JSON.stringify({ user_id: 2 }));
    if (scenario === 'unmount') context.page.unmount();
    await context.page.flush(); old.resolve({ reviews: [savedReview(11, '旧账户秘密')], totalPages: 1 });
    await new Promise(setImmediate);
    const tree = await context.page.flush();
    assert.ok(!text(tree).includes('旧账户秘密'));
    assert.equal(context.requests.filter(request => request.method === 'post').length, 0);
  }
  const context = reviews(); const tree = await context.page.flush({});
  context.localStorage.setItem('token', 'another-tab');
  await submit(forms(tree)[0]);
  assert.equal(context.requests.length, 1);
});

test('old saves and failures cannot change another customers pending save, drafts or notices', async () => {
  for (const outcome of ['success', 'failure']) {
    const old = deferred(), current = deferred(); let count = 0;
    const context = reviews({ save: () => ++count === 1 ? old.promise : current.promise });
    let tree = await context.page.flush({});
    const savingA = submit(forms(tree)[0]);
    context.useAuthStore.getState().login({ user_id: 2, username: 'two', email: 'two@example.test' }, 'buyer-two');
    tree = await context.page.flush();
    const savingB = submit(forms(tree)[0]);
    if (outcome === 'success') old.resolve({ review_id: 88 });
    else old.reject({ response: { status: 409, data: { error: '旧保存失败' } } });
    await savingA; tree = await context.page.flush();
    assert.equal(forms(tree).length, 2); assert.ok(!text(tree).includes('旧保存失败'));
    assert.equal(button(tree, '提交中...').props.disabled, true);
    assert.equal(context.requests.filter(request => request.method === 'get').length, 2);
    current.resolve({ review_id: 89 }); await savingB; tree = await context.page.flush();
    assert.equal(forms(tree).length, 1); assert.ok(text(tree).includes('评论成功'));
  }
});

test('an obsolete retry action cannot start a reload during saving or erase another products saved review', async () => {
  let count = 0; const pending = deferred();
  const context = reviews({ list: async () => {
    if (++count === 1) throw new Error('offline');
    return { reviews: [savedReview(12, '另一商品的已保存评价')], totalPages: 1 };
  }, save: () => pending.promise });
  let tree = await context.page.flush({});
  const retry = button(tree, '重新加载评价').props.onClick;
  await retry(); tree = await context.page.flush();
  const saving = submit(forms(tree)[0]);
  await retry();
  assert.equal(count, 2);
  pending.resolve({ review_id: 90 }); await saving; tree = await context.page.flush();
  assert.equal(forms(tree).length, 0); assert.ok(text(tree).includes('另一商品的已保存评价'));
});
