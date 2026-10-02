const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStores, loadPage, findElements } = require('./runtime.cjs');

function textContent(tree) {
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree?.props ? textContent(tree.props.children) : '';
}
const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const base = { product_id: 1, title: 'Shirt', price: 10, stock: 99, main_image: '/base.jpg' };
const product = { ...base, has_sku: true, skus: [
  { sku_id: 101, sku_code: 'RED', specs: { Color: 'Red', Size: 'M' }, price: 20, stock: 2, image: '/red.jpg' },
  { sku_id: 102, sku_code: 'BLUE', specs: { Color: 'Blue', Size: 'L' }, price: 30, stock: 4, image: '/blue.jpg' },
  { sku_id: 103, sku_code: 'EMPTY', specs: { Color: 'Black' }, price: 40, stock: 0 },
] };

function setupProduct({ detail = async () => ({ product }), add = async () => ({}), favorite = async () => ({ is_favorited: false }), authenticated = true } = {}) {
  const stores = loadStores();
  if (authenticated) stores.useAuthStore.getState().login(firstUser, 'first-session');
  else stores.useAuthStore.getState().hydrate();
  const params = { id: '1' };
  const redirects = [];
  const router = { push: url => redirects.push(url) };
  const additions = [];
  const notifications = [];
  const toast = { error: message => notifications.push(message), success: message => notifications.push(message) };
  const runtime = loadPage('src/app/products/[id]/page.tsx', { globals: stores, imports: {
    'next/navigation': { useParams: () => params, useRouter: () => router },
    '@/components/ProductCard': () => null,
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    '@/store/useCartStore': { useCartStore: () => stores.useCartStore.getState() },
    'react-hot-toast': { __esModule: true, default: toast, toast },
    '@/lib/api': {
      productApi: { getDetail: detail },
      cartApi: { add: async input => { additions.push(JSON.parse(JSON.stringify(input))); return add(input); } },
      reviewApi: { listByProduct: async () => ({ reviews: [] }) },
      recommendationApi: { getRelated: async () => ({ related_products: [] }) },
      favoriteApi: { check: favorite, toggle: async () => ({ is_favorited: true }) },
      browseApi: { record: async () => ({}) },
    },
  } });
  return { ...stores, runtime, params, redirects, additions, notifications };
}
const button = (tree, label) => findElements(tree, element => element.type === 'button' && textContent(element) === label)[0];
const selector = tree => findElements(tree, element => element.type === 'select' && element.props.id === 'product-sku')[0];

test('SKU purchase requires explicit selection and uses that variant price, image, stock and cart identity', async () => {
  const { runtime, additions, useCartStore, redirects } = setupProduct();
  let tree = await runtime.flush({});
  assert.ok(selector(tree), 'an explicit SKU selector must be rendered');
  assert.equal(selector(tree).props.value, '');
  assert.equal(button(tree, '加入购物车').props.disabled, true);
  await button(tree, '立即购买').props.onClick();
  assert.deepEqual(additions, []);
  assert.deepEqual(redirects, []);
  selector(tree).props.onChange({ target: { value: '101' } });
  tree = await runtime.flush();
  assert.ok(textContent(tree).includes('¥20'));
  assert.ok(textContent(tree).includes('库存 2 件'));
  assert.equal(findElements(tree, element => element.type === 'img')[0].props.src, '/red.jpg');
  const quantity = findElements(tree, element => element.type === 'input' && element.props.type === 'number')[0];
  assert.equal(quantity.props.max, 2);
  quantity.props.onChange({ target: { value: '99' } });
  tree = await runtime.flush();
  assert.equal(findElements(tree, element => element.type === 'input')[0].props.value, 2);
  await button(tree, '立即购买').props.onClick();
  assert.deepEqual(additions, [{ product_id: 1, quantity: 2, sku_id: 101 }]);
  const item = useCartStore.getState().items[0];
  assert.equal(item.sku_id, 101);
  assert.equal(item.price, 20);
  assert.equal(item.main_image, '/red.jpg');
  assert.deepEqual(JSON.parse(JSON.stringify(item.sku_specs)), { Color: 'Red', Size: 'M' });
  assert.equal(item.sku_code, 'RED');
  assert.deepEqual(redirects, ['/cart']);
});

test('failed add and anonymous buy never report success or navigate to cart', async () => {
  for (const authenticated of [true, false]) {
    const { runtime, redirects, useCartStore, additions, notifications } = setupProduct({
      authenticated, detail: async () => ({ product: { ...base, has_sku: false } }),
      add: async () => { throw { response: { data: { error: '库存不足' } } }; },
    });
    const tree = await runtime.flush({});
    await button(tree, '立即购买').props.onClick();
    assert.ok(!redirects.includes('/cart'));
    assert.equal(useCartStore.getState().items.length, 0);
    assert.equal(additions.length, authenticated ? 1 : 0);
    assert.ok(!notifications.includes('已加入购物车'));
  }
});

test('products with only disabled SKU rows cannot fall back to plentiful base inventory', async () => {
  const { runtime, additions } = setupProduct({ detail: async () => ({ product: { ...base, has_sku: true, skus: [] } }) });
  const tree = await runtime.flush({});
  assert.ok(textContent(tree).includes('暂无可用规格'));
  const actions = findElements(tree, element => element.type === 'button' && element.props.className?.includes('flex-1 btn'));
  assert.equal(actions.length, 2);
  assert.ok(actions.every(action => action.props.disabled));
  await actions[1].props.onClick();
  assert.deepEqual(additions, []);
});

test('a late previous product response cannot replace the route or select a variant on the next product', async () => {
  for (const outcome of ['success', 'failure']) {
    let finishFirst, failFirst;
    const pending = new Promise((resolve, reject) => { finishFirst = resolve; failFirst = reject; });
    const { runtime, params, redirects, notifications } = setupProduct({ detail: id => id === 1 ? pending : Promise.resolve({ product: { ...product, product_id: 2, title: 'Second shirt' } }) });
    await runtime.flush({});
    params.id = '2';
    let tree = await runtime.flush();
    selector(tree).props.onChange({ target: { value: '102' } });
    tree = await runtime.flush();
    if (outcome === 'success') finishFirst({ product });
    else failFirst(new Error('Old product unavailable'));
    await new Promise(setImmediate);
    tree = await runtime.flush();
    assert.ok(textContent(tree).includes('Second shirt'));
    assert.equal(selector(tree).props.value, 102);
    assert.deepEqual(redirects, []);
    assert.ok(!notifications.includes('商品不存在'));
  }
});

test('late add success or error after route, account, storage or unmount changes cannot mutate another cart or navigate', async () => {
  for (const change of ['route', 'account', 'storage', 'unmount']) {
    for (const outcome of ['success', 'failure']) {
      let finishAdd, failAdd;
      const pending = new Promise((resolve, reject) => { finishAdd = resolve; failAdd = reject; });
      const { runtime, params, redirects, notifications, useAuthStore, useCartStore, localStorage } = setupProduct({ add: () => pending });
      let tree = await runtime.flush({});
      selector(tree).props.onChange({ target: { value: '101' } });
      tree = await runtime.flush();
      const submission = button(tree, '立即购买').props.onClick();
      if (change === 'route') { params.id = '2'; await runtime.flush(); }
      if (change === 'account') { useAuthStore.getState().login(secondUser, 'second-session'); await runtime.flush(); }
      if (change === 'storage') localStorage.setItem('token', 'second-session');
      if (change === 'unmount') runtime.unmount();
      useCartStore.getState().setItems([{ cart_id: 9, product_id: 1, sku_id: 102, quantity: 1, title: 'B item', price: 30, stock: 4 }]);
      if (outcome === 'success') finishAdd({});
      else failAdd({ response: { data: { error: '旧请求失败' } } });
      await submission;
      assert.deepEqual(Array.from(useCartStore.getState().items, item => item.sku_id), [102], `${change}/${outcome}`);
      assert.deepEqual(redirects, [], `${change}/${outcome}`);
      assert.ok(!notifications.includes('已加入购物车'));
      assert.ok(!notifications.includes('旧请求失败'));
    }
  }
});

test('switching customer invalidates a late favorite read and requires a fresh explicit SKU selection', async () => {
  let finishFavorite;
  let calls = 0;
  const pending = new Promise(resolve => { finishFavorite = resolve; });
  const { runtime, useAuthStore } = setupProduct({ favorite: () => ++calls === 1 ? pending : Promise.resolve({ is_favorited: false }) });
  let tree = await runtime.flush({});
  selector(tree).props.onChange({ target: { value: '101' } });
  await runtime.flush();
  useAuthStore.getState().login(secondUser, 'second-session');
  tree = await runtime.flush();
  assert.equal(selector(tree).props.value, '');
  finishFavorite({ is_favorited: true });
  await new Promise(setImmediate);
  tree = await runtime.flush();
  assert.equal(findElements(tree, element => element.type === 'button' && element.props.title === '收藏').length, 1);
  assert.equal(calls, 2);
});
