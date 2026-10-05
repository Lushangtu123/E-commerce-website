const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, findElements } = require('./runtime.cjs');

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const product = (id) => ({ product_id: id, title: `Product ${id}`, price: id });
const anonymous = { isAuthenticated: false };
const customer = { isAuthenticated: true };

function home({ hot = async () => ({ products: [product(1)] }), latest = async () => ({ products: [product(2)] }), recommend = async () => ({ recommendations: [] }) } = {}) {
  const toasts = [];
  const calls = { recommend: 0 };
  const runtime = loadPage('src/components/HomePage.tsx', { imports: {
    '@/lib/api': {
      productApi: { getHotProducts: hot, list: latest },
      recommendationApi: { getGuessYouLike: (...args) => { calls.recommend += 1; return recommend(...args); } },
    },
    '@/components/ProductCard': { __esModule: true, default: function ProductCard() { return null; }, ProductCardSkeleton: function ProductCardSkeleton() { return null; } },
    'react-hot-toast': { __esModule: true, default: { error: (message) => toasts.push(message), success() {} } },
  } });
  return { runtime, toasts, calls };
}

// ProductSection is not rendered by the shallow runtime, so its props are the contract.
const sections = (tree) => Object.fromEntries(findElements(tree, (element) => Array.isArray(element.props.products)).map((element) => [element.props.title, element.props]));
const ids = (section) => [...section.products].map((item) => item.product_id);

test('home shows hot and new products and hides empty recommendations', async () => {
  const { runtime, toasts } = home();
  const tree = await runtime.flush(anonymous);
  const found = sections(tree);
  assert.deepEqual(ids(found['热门商品']), [1]);
  assert.deepEqual(ids(found['新品推荐']), [2]);
  assert.equal(found['热门商品'].loading, false);
  assert.equal(found['猜你喜欢'], undefined);
  assert.deepEqual(toasts, []);
});

test('a failing hot product request does not blank the new products', async () => {
  const { runtime, toasts } = home({ hot: async () => { throw new Error('offline'); } });
  const found = sections(await runtime.flush(anonymous));
  assert.deepEqual(ids(found['热门商品']), []);
  assert.deepEqual(ids(found['新品推荐']), [2]);
  assert.equal(found['新品推荐'].loading, false);
  assert.deepEqual(toasts, ['加载数据失败']);
});

test('an older recommendation response cannot replace the one for the hydrated session', async () => {
  const pending = [deferred(), deferred()];
  const context = home({ recommend: () => pending[context.calls.recommend - 1].promise });
  await context.runtime.flush(anonymous);
  await context.runtime.flush(customer);
  assert.equal(context.calls.recommend, 2);
  pending[1].resolve({ recommendations: [product(7)] });
  await context.runtime.flush(customer);
  pending[0].resolve({ recommendations: [product(9)] });
  const found = sections(await context.runtime.flush(customer));
  assert.deepEqual(ids(found['猜你喜欢']), [7]);
  assert.equal(found['猜你喜欢'].subtitle, '基于您的浏览历史为您推荐');
  assert.equal(found['猜你喜欢'].loading, false);
});

test('recommendations describe the session they were fetched for and clear when the latest request fails', async () => {
  let fail = false;
  const context = home({ recommend: async () => { if (fail) throw new Error('offline'); return { recommendations: [product(5)] }; } });
  let found = sections(await context.runtime.flush(anonymous));
  assert.equal(found['猜你喜欢'].subtitle, '热门商品推荐');
  fail = true;
  found = sections(await context.runtime.flush(customer));
  assert.equal(found['猜你喜欢'], undefined, 'generic picks must not stay labelled as personal ones');
});
