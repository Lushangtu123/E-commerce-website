const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

const userA = { user_id: 1, username: 'A', email: 'a@test' };
const userB = { user_id: 2, username: 'B', email: 'b@test' };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function header({ getHistory = async () => ({ history: [{ keyword: 'My search' }] }), record = async () => ({}), deleteKeyword = async () => ({}) } = {}) {
  const browser = loadStores();
  const requests = [], mutations = [];
  const auth = Object.assign(() => browser.useAuthStore.getState(), { getState: () => browser.useAuthStore.getState() });
  const runtime = loadPage('src/components/Header.tsx', {
    globals: { ...browser, document: { addEventListener() {}, removeEventListener() {} } },
    imports: {
      '@/store/useAuthStore': { useAuthStore: auth },
      '@/store/useCartStore': { useCartStore: () => ({ getTotalCount: () => 0 }) },
      '@/lib/api': { searchApi: {
        getHistory: (...args) => { requests.push({ token: browser.useAuthStore.getState().token, args }); return getHistory(...args); },
        getHot: async () => ({ keywords: [] }),
        record: keyword => { mutations.push(['record', keyword]); return record(keyword); },
        deleteKeyword: keyword => { mutations.push(['delete', keyword]); return deleteKeyword(keyword); },
      } },
    },
  });
  return { ...browser, runtime, requests, mutations };
}

test('search history loads when persisted customer identity hydrates after Header mounts', async () => {
  const context = header();
  await context.runtime.flush({});
  context.localStorage.setItem('token', 'session-A');
  context.localStorage.setItem('user', JSON.stringify(userA));
  context.useAuthStore.getState().hydrate();
  let tree = await context.runtime.flush();
  findElements(tree, e => e.type === 'input')[0].props.onFocus();
  tree = await context.runtime.flush();
  assert.equal(context.requests.length, 1);
  assert.ok(text(tree).includes('My search'));
  context.runtime.unmount();
});

test('late history cannot appear in a replacement customer session', async () => {
  const pending = deferred();
  let calls = 0;
  const context = header({ getHistory: () => ++calls === 1 ? pending.promise : Promise.resolve({ history: [{ keyword: 'B search' }] }) });
  context.useAuthStore.getState().login(userA, 'session-A');
  await context.runtime.flush({});
  context.useAuthStore.getState().login(userB, 'session-B');
  let tree = await context.runtime.flush();
  findElements(tree, e => e.type === 'input')[0].props.onFocus();
  pending.resolve({ history: [{ keyword: 'Private A search' }] });
  tree = await context.runtime.flush();
  assert.ok(text(tree).includes('B search'));
  assert.ok(!text(tree).includes('Private A search'));
  context.runtime.unmount();
});

function products(list) {
  let params = new URLSearchParams({ keyword: 'old' });
  const requests = [], routes = [], errors = [];
  const runtime = loadPage('src/app/products/page.tsx', {
    globals: { window: { scrollTo() {}, location: { href: '/products' } } },
    imports: {
      'next/navigation': { useSearchParams: () => params, useRouter: () => ({ push: value => routes.push(value) }) },
      '@/components/ProductCard': () => null,
      '@/lib/api': { productApi: { list: query => { requests.push(query); return list(query); } } },
      'react-hot-toast': { __esModule: true, default: { error: message => errors.push(message) } },
    },
    renderPage(Page, props) {
      const content = Page(props).props.children;
      return content.type(content.props);
    },
  });
  return { runtime, requests, routes, errors, setQuery: value => { params = new URLSearchParams(value); } };
}
const cards = tree => findElements(tree, e => !!e.props.product).map(e => e.props.product.title);
const productResult = (title, pages = 1) => ({ products: [{ product_id: 1, title }], total: pages * 20, totalPages: pages });

test('a late old search cannot overwrite the newer keyword results', async () => {
  const old = deferred(), next = deferred();
  const context = products(query => query.keyword === 'old' ? old.promise : next.promise);
  await context.runtime.flush({});
  context.setQuery({ keyword: 'new' });
  await context.runtime.flush();
  next.resolve(productResult('New result'));
  let tree = await context.runtime.flush();
  assert.deepEqual(cards(tree), ['New result']);
  old.resolve(productResult('Old result'));
  tree = await context.runtime.flush();
  assert.deepEqual(cards(tree), ['New result']);
  context.runtime.unmount();
});

test('changing keyword from a later page requests page one and hides the old cards immediately', async () => {
  const next = deferred();
  const context = products(query => query.keyword === 'old' ? Promise.resolve(productResult(`Old page ${query.page}`, 3)) : next.promise);
  let tree = await context.runtime.flush({});
  findElements(tree, e => e.type === 'button' && text(e) === '3')[0].props.onClick();
  tree = await context.runtime.flush();
  assert.deepEqual(cards(tree), ['Old page 3']);
  context.setQuery({ keyword: 'new' });
  tree = await context.runtime.render();
  assert.deepEqual(cards(tree), []);
  assert.equal(context.requests.at(-1).page, 1);
  next.resolve(productResult('New page one'));
  tree = await context.runtime.flush();
  assert.deepEqual(cards(tree), ['New page one']);
  context.runtime.unmount();
});

test('failed searches show an error with retry rather than a successful empty result', async () => {
  let calls = 0;
  const context = products(async () => { if (++calls === 1) throw new Error('Offline'); return productResult('Recovered'); });
  let tree = await context.runtime.flush({});
  assert.ok(findElements(tree, e => e.props.role === 'alert').length);
  assert.ok(!text(tree).includes('暂无商品'));
  await findElements(tree, e => e.type === 'button' && text(e) === '重新加载')[0].props.onClick();
  tree = await context.runtime.flush();
  assert.deepEqual(cards(tree), ['Recovered']);
  context.runtime.unmount();
});

test('sorting navigates within the product list and resets a later page', async () => {
  const context = products(async query => productResult(`${query.sort} page ${query.page}`, 3));
  let tree = await context.runtime.flush({});
  findElements(tree, e => e.type === 'button' && text(e) === '3')[0].props.onClick();
  tree = await context.runtime.flush();
  findElements(tree, e => e.type === 'select')[0].props.onChange({ target: { value: 'price ASC' } });
  assert.equal(context.routes.length, 1);
  const query = new URL(context.routes[0], 'http://localhost').searchParams;
  assert.equal(query.get('keyword'), 'old');
  assert.equal(query.get('sort'), 'price ASC');
  context.setQuery(query);
  tree = await context.runtime.flush();
  assert.equal(context.requests.at(-1).page, 1);
  assert.deepEqual(cards(tree), ['price ASC page 1']);
  context.runtime.unmount();
});

test('returning to an earlier keyword while its replacement is pending still starts at page one', async () => {
  const pending = deferred();
  const context = products(query => query.keyword === 'new' ? pending.promise : Promise.resolve(productResult(`Old page ${query.page}`, 3)));
  let tree = await context.runtime.flush({});
  findElements(tree, e => e.type === 'button' && text(e) === '3')[0].props.onClick();
  await context.runtime.flush();
  context.setQuery({ keyword: 'new' });
  await context.runtime.flush();
  context.setQuery({ keyword: 'old' });
  tree = await context.runtime.flush();
  assert.equal(context.requests.at(-1).page, 1);
  assert.deepEqual(cards(tree), ['Old page 1']);
  pending.resolve(productResult('Obsolete new result'));
  await context.runtime.flush();
  context.runtime.unmount();
});

test('stale search history actions and late mutations cannot act on the next account', async () => {
  for (const operation of ['record', 'delete']) {
    const pending = deferred();
    const context = header({ getHistory: async () => ({ history: [{ keyword: 'Own history' }] }), [operation === 'delete' ? 'deleteKeyword' : 'record']: () => pending.promise });
    context.useAuthStore.getState().login(userA, 'session-A');
    let tree = await context.runtime.flush({});
    findElements(tree, e => e.type === 'input')[0].props.onFocus();
    findElements(tree, e => e.type === 'input')[0].props.onChange({ target: { value: '  My query  ' } });
    tree = await context.runtime.flush();
    const action = operation === 'record'
      ? findElements(tree, e => e.type === 'form')[0].props.onSubmit
      : findElements(tree, e => e.type === 'button' && e.props.title === '删除')[0].props.onClick;
    const event = { preventDefault() {}, stopPropagation() {} };
    const work = action(event);
    assert.equal(context.mutations.length, 1);
    if (operation === 'record') assert.equal(context.runtime.redirects[0], '/products?keyword=My%20query');
    context.useAuthStore.getState().login(userB, 'session-B');
    await context.runtime.flush();
    await action(event);
    assert.equal(context.mutations.length, 1);
    pending.resolve({}); await work;
    assert.equal(context.requests.length, 2);
    context.runtime.unmount();
  }
});

test('history responses respect a rotated token, changed browser storage and unmount', async () => {
  for (const change of ['rotation', 'storage', 'unmount']) {
    const pending = deferred(); let calls = 0;
    const context = header({ getHistory: () => ++calls === 1 ? pending.promise : Promise.resolve({ history: [{ keyword: 'Fresh history' }] }) });
    context.useAuthStore.getState().login(userA, 'session-A');
    await context.runtime.flush({});
    if (change === 'rotation') { context.useAuthStore.getState().login(userA, 'rotated-session'); await context.runtime.flush(); }
    if (change === 'storage') context.localStorage.setItem('token', 'other-session');
    if (change === 'unmount') context.runtime.unmount();
    pending.resolve({ history: [{ keyword: 'Obsolete private history' }] });
    let tree = await context.runtime.flush();
    findElements(tree, e => e.type === 'input')[0].props.onFocus();
    tree = await context.runtime.flush();
    assert.ok(!text(tree).includes('Obsolete private history'));
    if (change === 'rotation') assert.ok(text(tree).includes('Fresh history'));
    context.runtime.unmount();
  }
});

test('old failures cannot clear current products or show an error after query change or unmount', async () => {
  for (const change of ['query', 'unmount']) {
    const pending = deferred();
    const context = products(query => query.keyword === 'old' ? pending.promise : Promise.resolve(productResult('Current result')));
    await context.runtime.flush({});
    if (change === 'query') { context.setQuery({ keyword: 'new' }); await context.runtime.flush(); }
    else context.runtime.unmount();
    pending.reject(new Error('Obsolete failure'));
    const tree = await context.runtime.flush();
    assert.deepEqual(context.errors, []);
    if (change === 'query') assert.deepEqual(cards(tree), ['Current result']);
    context.runtime.unmount();
  }
});

test('unavailable browser storage fails closed for private search history without crashing Header', async () => {
  const context = header();
  context.useAuthStore.getState().login(userA, 'session-A');
  context.localStorage.getItem = () => { throw new Error('Storage unavailable'); };
  await assert.doesNotReject(() => context.runtime.flush({}));
  assert.equal(context.requests.length, 0);
  context.runtime.unmount();
});

test('an obsolete pagination action cannot replace the current query pagination', async () => {
  const context = products(async query => productResult(query.keyword, query.keyword === 'old' ? 3 : 1));
  let tree = await context.runtime.flush({});
  const oldPage = findElements(tree, e => e.type === 'button' && text(e) === '3')[0];
  context.setQuery({ keyword: 'new' });
  tree = await context.runtime.flush();
  oldPage.props.onClick();
  tree = await context.runtime.flush();
  assert.ok(text(tree).includes('共找到 20 件商品'));
  assert.deepEqual(cards(tree), ['new']);
  context.runtime.unmount();
});

test('cached private history is hidden when browser credentials change before auth hydration', async () => {
  const context = header();
  context.useAuthStore.getState().login(userA, 'session-A');
  let tree = await context.runtime.flush({});
  findElements(tree, e => e.type === 'input')[0].props.onFocus();
  tree = await context.runtime.flush();
  assert.ok(text(tree).includes('My search'));
  context.localStorage.setItem('token', 'session-B');
  tree = await context.runtime.flush();
  assert.ok(!text(tree).includes('My search'));
  context.runtime.unmount();
});
