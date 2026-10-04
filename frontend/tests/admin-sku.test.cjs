const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi, loadSource, loadPage, findElements } = require('./runtime.cjs');
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const input = (tree, name) => findElements(tree, element => ['input', 'textarea', 'select'].includes(element.type) && element.props.name === name)[0];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const product = { product_id: 1, title: '原始中文商品', status: 1 };
const sku = { sku_id: 11, product_id: 1, sku_code: 'BLUE-M', specs: { Color: 'Blue', Size: 'M' }, price: '12.50', stock: 2, original_price: null, image: null, status: 1 };

function setup({ list = async () => ({ product, skus: [sku] }), mutate = async () => ({ sku_id: 12 }), locale = 'zh-CN', route = 'src/app/admin/products/[id]/skus/page.tsx' } = {}) {
  const browser = loadApi({ token: 'customer-session', admin_token: 'admin-one', admin_user: JSON.stringify({ admin_id: 1, username: '测试管理员' }) });
  const listeners = new Map();
  const window = { ...browser.window, addEventListener(name, listener) { const values = listeners.get(name) || []; values.push(listener); listeners.set(name, values); }, removeEventListener(name, listener) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== listener)); }, dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); } };
  const globals = { ...browser, window };
  const session = loadSource('src/lib/admin-session.ts', globals);
  const localeStore = loadSource('src/store/useLocaleStore.ts', globals); localeStore.useLocaleStore.getState().setLocale(locale);
  const i18n = loadSource('src/lib/i18n.ts', globals, { '@/store/useLocaleStore': localeStore });
  const requests = [];
  browser.default.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ url: config.url, method: config.method, body, authorization: config.headers.get('Authorization') });
    const data = config.method === 'get' ? await list(config) : await mutate(config.url, body);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const params = { id: '1' }, router = { push() {} };
  const page = loadPage(route, { globals, imports: {
    '@/components/AdminLayout': ({ children }) => children,
    '@/lib/api': { __esModule: true, ...browser },
    '@/lib/admin-session': session,
    '@/lib/i18n': { ...i18n, useI18n: () => ({ t: i18n.translate }) },
    'next/navigation': { useParams: () => params, useRouter: () => router },
  } });
  const changeSession = (token = 'admin-two') => { browser.localStorage.setItem('admin_token', token); browser.localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: '另一个管理员' })); window.dispatchEvent({ type: 'storage', key: 'admin_token', storageArea: browser.localStorage }); };
  return { ...browser, page, requests, params, window, changeSession, localeStore };
}

test('admin product list links each product to its SKU management screen', async () => {
  const context = setup({ route: 'src/app/admin/products/page.tsx', list: async config => config.url === '/products/categories' ? [] : { products: [{ ...product, price: 10, stock: 3 }], pagination: { total: 1 } } });
  const tree = await context.page.flush({});
  assert.equal(findElements(tree, element => element.props.href === '/admin/products/1/skus').length, 1);
});

test('SKU manager loads disabled variants, parent identity and active price/inventory summary with admin credentials', async () => {
  const context = setup({ list: async () => ({ product, skus: [sku, { ...sku, sku_id: 12, sku_code: 'DISABLED', price: '1.00', stock: 99, status: 0 }] }) });
  const tree = await context.page.flush({});
  assert.ok(text(tree).includes('原始中文商品')); assert.ok(text(tree).includes('DISABLED'));
  assert.ok(text(tree).includes('可售库存：2')); assert.ok(text(tree).includes('最低售价：¥12.50'));
  assert.equal(context.requests[0].url, '/admin/products/1/skus');
  assert.equal(context.requests[0].authorization, 'Bearer admin-one');
});

async function edit(context, tree, values) {
  for (const [name, value] of Object.entries(values)) { input(tree, name).props.onChange({ target: { value } }); tree = await context.page.flush(); }
  return tree;
}
const submit = tree => findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });

test('new SKU editor submits normalized zero price/stock and reloads the server list using only admin credentials', async () => {
  let created;
  const context = setup({ list: async () => ({ product, skus: created ? [sku, created] : [sku] }), mutate: async (_url, body) => { created = { ...body, product_id: 1, sku_id: 12 }; return { sku_id: 12 }; } });
  let tree = await context.page.flush({});
  button(tree, '新增规格').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { sku_code: '  FREE-M  ', price: '0', stock: '0', 'spec-name-0': '  Color  ', 'spec-value-0': '  Green  ' });
  await submit(tree); tree = await context.page.flush();
  assert.deepEqual(context.requests[1], { method: 'post', url: '/admin/products/1/skus', authorization: 'Bearer admin-one', body: { sku_code: 'FREE-M', specs: { Color: 'Green' }, price: 0, original_price: null, stock: 0, image: null, status: 1 } });
  assert.equal(context.requests.filter(request => request.method === 'get').length, 2);
  assert.ok(text(tree).includes('FREE-M')); assert.equal(findElements(tree, element => element.type === 'form').length, 0);
  assert.ok(text(tree).includes('规格已保存')); assert.equal(context.localStorage.getItem('token'), 'customer-session');
});

test('editing binds both product and SKU IDs, preserves typed spec values and clears optional fields', async () => {
  let current = { ...sku, specs: { Size: 42, Waterproof: false }, original_price: '20.00', image: '/old.jpg' };
  const context = setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return { message: '更新成功' }; } });
  let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  assert.equal(input(tree, 'spec-value-0').props.value, '42'); assert.equal(input(tree, 'spec-value-1').props.value, 'false');
  tree = await edit(context, tree, { price: '15.25', original_price: '', image: '', stock: '4' });
  await submit(tree); tree = await context.page.flush();
  assert.equal(context.requests[1].url, '/admin/products/1/skus/11');
  assert.deepEqual(context.requests[1].body, { price: 15.25, original_price: null, image: null, stock: 4 });
  assert.ok(text(tree).includes('最低售价：¥15.25')); assert.ok(text(tree).includes('可售库存：4'));
});

test('disabling and enabling a SKU changes only its status and the available stock/price summary', async () => {
  let current = { ...sku };
  const context = setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return {}; } });
  let tree = await context.page.flush({}); await button(tree, '停用规格').props.onClick(); tree = await context.page.flush();
  assert.deepEqual(context.requests[1].body, { status: 0 }); assert.ok(text(tree).includes('可售库存：0')); assert.ok(text(tree).includes('暂无启用规格'));
  await button(tree, '启用规格').props.onClick(); tree = await context.page.flush();
  assert.deepEqual(context.requests[3].body, { status: 1 }); assert.ok(text(tree).includes('可售库存：2'));
});

test('English SKU labels and async errors follow the selected language without translating product/spec values', async () => {
  const pending = deferred(); const context = setup({ locale: 'en', mutate: () => pending.promise });
  let tree = await context.page.flush({}); assert.ok(text(tree).includes('SKU management')); assert.ok(text(tree).includes('原始中文商品'));
  button(tree, 'Edit variant').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { price: '13' });
  const saving = submit(tree); context.localeStore.useLocaleStore.getState().setLocale('zh-CN');
  pending.reject({ response: { data: { error: 'SKU编码已存在' } } }); await saving; tree = await context.page.flush();
  assert.ok(text(tree).includes('SKU编码已存在')); assert.equal(input(tree, 'price').props.value, '13');
});

test('a saved edit handler cannot replace an unsaved draft with another variant', async () => {
  const context = setup({ list: async () => ({ product, skus: [sku, { ...sku, sku_id: 12, sku_code: 'OTHER' }] }) });
  let tree = await context.page.flush({});
  const editors = findElements(tree, element => element.type === 'button' && text(element) === '编辑规格');
  editors[0].props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { price: '19' }); editors[1].props.onClick(); tree = await context.page.flush();
  assert.equal(input(tree, 'sku_code').props.value, 'BLUE-M'); assert.equal(input(tree, 'price').props.value, '19');
});

test('invalid fields cannot reach the API, and valid monetary/inventory boundaries remain usable', async () => {
  const context = setup(); let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  const values = { sku_code: 'BLUE-M', price: '12.50', stock: '2', original_price: '', image: '', status: '1', 'spec-name-0': 'Color', 'spec-value-0': 'Blue' };
  for (const [name, value, message] of [
    ['sku_code', '_bad', '规格编码须为'], ['sku_code', 'A'.repeat(51), '规格编码须为'],
    ['price', '-1', '金额须为'], ['price', '1.001', '金额须为'], ['price', '1e2', '金额须为'], ['price', '100000000', '金额须为'],
    ['stock', '1.5', '库存须为'], ['stock', '2147483648', '库存须为'], ['stock', '-1', '库存须为'],
    ['original_price', '1.001', '金额须为'], ['image', 'a'.repeat(256), '图片地址最多'], ['status', '2', '规格状态无效'],
    ['spec-name-0', ' ', '请填写1至20项规格'], ['spec-value-0', 'a'.repeat(101), '请填写1至20项规格'],
  ]) {
    tree = await edit(context, tree, { ...values, [name]: value }); await submit(tree); tree = await context.page.flush();
    assert.ok(text(tree).includes(message), `${name}: ${value}`); assert.equal(context.requests.length, 1);
  }
  tree = await edit(context, tree, { ...values, price: '99999999.99', original_price: '0', stock: '2147483647' });
  await submit(tree); assert.equal(context.requests[1].body.price, 99999999.99); assert.equal(context.requests[1].body.stock, 2147483647);
});

test('attribute rows support adding/removing, reject duplicates and stop at twenty', async () => {
  const context = setup(); let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { 'spec-name-1': ' Color ' }); await submit(tree); tree = await context.page.flush();
  assert.ok(text(tree).includes('规格名称不能重复')); assert.equal(context.requests.length, 1);
  button(tree, '移除').props.onClick(); tree = await context.page.flush();
  assert.equal(input(tree, 'spec-name-0').props.value, ' Color ');
  button(tree, '移除').props.onClick(); tree = await context.page.flush(); await submit(tree); tree = await context.page.flush();
  assert.ok(text(tree).includes('请填写1至20项规格'));
  for (let count = 0; count < 20; count++) { button(tree, '添加规格属性').props.onClick(); tree = await context.page.flush(); }
  assert.equal(findElements(tree, element => element.type === 'input' && element.props.name?.startsWith('spec-name-')).length, 20);
  assert.equal(button(tree, '添加规格属性').props.disabled, true);
});

test('failed saves retain the draft and can be retried; old handlers cannot submit twice or toggle concurrently', async () => {
  const pending = deferred(); let attempt = 0;
  const context = setup({ mutate: () => ++attempt === 1 ? pending.promise : Promise.resolve({}) });
  let tree = await context.page.flush({}); const toggle = button(tree, '停用规格').props.onClick;
  button(tree, '编辑规格').props.onClick(); tree = await context.page.flush(); tree = await edit(context, tree, { price: '19' });
  const savedSubmit = findElements(tree, element => element.type === 'form')[0].props.onSubmit;
  const saving = savedSubmit({ preventDefault() {} }); await savedSubmit({ preventDefault() {} }); await toggle();
  tree = await context.page.flush(); assert.equal(context.requests.length, 2); assert.equal(button(tree, '保存中...').props.disabled, true);
  pending.reject({ response: { data: { error: '权限不足' } } }); await saving; tree = await context.page.flush();
  assert.ok(text(tree).includes('权限不足')); assert.equal(input(tree, 'price').props.value, '19');
  await submit(tree); tree = await context.page.flush(); assert.equal(attempt, 2); assert.ok(text(tree).includes('规格已保存'));
});

test('a successful create with a failed list refresh closes the form and retry only reloads', async () => {
  let reads = 0;
  const context = setup({ list: async () => { if (++reads === 2) throw new Error('offline'); return { product, skus: [sku] }; } });
  let tree = await context.page.flush({}); button(tree, '新增规格').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { sku_code: 'NEW', price: '5', 'spec-name-0': 'Color', 'spec-value-0': 'Red' });
  await submit(tree); tree = await context.page.flush(); assert.ok(text(tree).includes('规格已保存，但列表刷新失败'));
  assert.equal(findElements(tree, element => element.type === 'form').length, 0); await button(tree, '重新加载').props.onClick(); tree = await context.page.flush();
  assert.equal(context.requests.filter(row => row.method === 'post').length, 1); assert.ok(text(tree).includes('BLUE-M'));
});

test('invalid routes and missing or malformed admin sessions never request or expose a SKU editor', async () => {
  for (const scenario of ['id', 'missing-token', 'malformed-user']) {
    const context = setup();
    if (scenario === 'id') context.params.id = '1e2';
    if (scenario === 'missing-token') context.localStorage.removeItem('admin_token');
    if (scenario === 'malformed-user') context.localStorage.setItem('admin_user', '{}');
    const tree = await context.page.flush({}); assert.equal(context.requests.length, 0); assert.equal(button(tree, '新增规格'), undefined);
  }
});

test('late reads are ignored after product, administrator, raw storage or unmount changes', async () => {
  for (const scenario of ['product', 'account', 'storage', 'unmount']) for (const fail of [false, true]) {
    const pending = deferred(); let reads = 0;
    const context = setup({ list: async () => ++reads === 1 ? pending.promise : { product: { ...product, product_id: Number(context.params.id), title: '新页面商品' }, skus: [] } });
    await context.page.flush({});
    if (scenario === 'product') context.params.id = '2';
    if (scenario === 'account') context.changeSession();
    if (scenario === 'storage') context.localStorage.setItem('admin_token', 'raw-other');
    if (scenario === 'unmount') context.page.unmount(); else await context.page.flush();
    if (fail) pending.reject({ response: { data: { error: '旧错误' } } }); else pending.resolve({ product, skus: [sku] });
    await new Promise(setImmediate);
    if (scenario !== 'unmount') { const tree = await context.page.flush(); assert.ok(!text(tree).includes('原始中文商品')); assert.ok(!text(tree).includes('旧错误')); }
    assert.equal(context.requests.length, scenario === 'product' || scenario === 'account' ? 2 : 1);
  }
});

test('late mutation outcomes cannot refresh or report success in another product/session or an unmounted page', async () => {
  for (const scenario of ['product', 'account', 'storage', 'unmount']) for (const fail of [false, true]) {
    const pending = deferred(); const context = setup({ mutate: () => pending.promise, list: async () => ({ product: { ...product, product_id: Number(context.params.id) }, skus: Number(context.params.id) === 1 ? [sku] : [] }) });
    let tree = await context.page.flush({}); const oldToggle = button(tree, '停用规格').props.onClick;
    const saving = oldToggle();
    if (scenario === 'product') context.params.id = '2';
    if (scenario === 'account') context.changeSession();
    if (scenario === 'storage') context.localStorage.setItem('admin_token', 'raw-other');
    if (scenario === 'unmount') context.page.unmount(); else await context.page.flush();
    await oldToggle(); const before = context.requests.length;
    if (fail) pending.reject({ response: { data: { error: '旧保存错误' } } }); else pending.resolve({});
    await saving;
    assert.equal(context.requests.length, before);
    if (scenario !== 'unmount') { tree = await context.page.flush(); assert.ok(!text(tree).includes('规格已停用')); assert.ok(!text(tree).includes('旧保存错误')); }
  }
});

test('malformed or mismatched SKU responses fail closed and allow a reload', async () => {
  for (const broken of [
    { product: { ...product, product_id: 2 }, skus: [sku] }, { product, skus: [{ ...sku, product_id: 2 }] },
    { product, skus: [{ ...sku, price: null }] }, { product, skus: [{ ...sku, specs: { Color: { nested: 'unsafe' } } }] },
  ]) {
    let reads = 0; const context = setup({ list: async () => ++reads === 1 ? broken : { product, skus: [sku] } });
    let tree = await context.page.flush({}); assert.ok(text(tree).includes('获取SKU列表失败')); assert.equal(button(tree, '编辑规格'), undefined);
    await button(tree, '重新加载').props.onClick(); tree = await context.page.flush(); assert.ok(button(tree, '编辑规格'));
  }
});

test('SKU subroutes keep Products highlighted without matching a similarly named route', async () => {
  for (const pathname of ['/admin/products/1/skus', '/admin/products-other']) {
    const context = loadApi({ admin_token: 'admin-session', admin_user: JSON.stringify({ admin_id: 1, username: 'owner' }) });
    const router = { push() {} };
    const page = loadPage('src/components/AdminLayout.tsx', { globals: context, imports: { 'next/navigation': { useRouter: () => router, usePathname: () => pathname } } });
    const tree = await page.flush({});
    const link = findElements(tree, element => element.props.href === '/admin/products')[0];
    assert.equal(link.props.className.includes('bg-blue-600'), pathname === '/admin/products/1/skus');
  }
});

test('an inactive parent warns that enabling variants alone does not make the product purchasable', async () => {
  const context = setup({ locale: 'en', list: async () => ({ product: { ...product, status: 0 }, skus: [sku] }) });
  const tree = await context.page.flush({}); assert.ok(text(tree).includes('This product is unavailable. Activate the product to allow purchases.'));
});

test('SKU API failures are readable in English while preserving the editable draft', async () => {
  for (const error of ['SKU不存在', 'SKU不属于该商品', 'SKU字段或值无效', '商品不存在', '商品或SKU ID、字段或值无效']) {
    const context = setup({ locale: 'en', mutate: async () => { throw { response: { data: { error } } }; } });
    let tree = await context.page.flush({}); button(tree, 'Edit variant').props.onClick(); tree = await context.page.flush();
    tree = await edit(context, tree, { price: '13' }); await submit(tree); tree = await context.page.flush();
    const alert = findElements(tree, element => element.props.role === 'alert')[0]; assert.ok(alert); assert.ok(!/[\u3400-\u9fff]/.test(text(alert)), error);
    assert.equal(input(tree, 'sku_code').props.value, 'BLUE-M');
  }
});

test('price-only edits omit stock so a purchase after opening the editor cannot be overwritten', async () => {
  let current = { ...sku };
  const context = setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return {}; } });
  let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  current = { ...current, stock: 1 }; // A buyer purchases one unit while the editor is open.
  tree = await edit(context, tree, { price: '13' }); await submit(tree); tree = await context.page.flush();
  assert.deepEqual(context.requests[1].body, { price: 13 }); assert.ok(text(tree).includes('可售库存：1'));
});

test('changing attributes retains untouched numeric/boolean values and submits only specs', async () => {
  const context = setup({ list: async () => ({ product, skus: [{ ...sku, specs: { Size: 42, Waterproof: false } }] }) });
  let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  button(tree, '添加规格属性').props.onClick(); tree = await context.page.flush();
  tree = await edit(context, tree, { 'spec-name-2': 'Color', 'spec-value-2': 'Blue' }); await submit(tree);
  assert.deepEqual(context.requests[1].body, { specs: { Size: 42, Waterproof: false, Color: 'Blue' } });
});

test('saving an unchanged edit does not write stock or create an unnecessary audit event', async () => {
  const context = setup(); let tree = await context.page.flush({}); button(tree, '编辑规格').props.onClick(); tree = await context.page.flush();
  await submit(tree); tree = await context.page.flush(); assert.equal(context.requests.length, 1); assert.ok(text(tree).includes('没有需要保存的修改'));
});
