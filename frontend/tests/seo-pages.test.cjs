const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource, loadPage, findElements } = require('./runtime.cjs');

const site = () => loadSource('src/lib/site.ts', { AbortSignal, Response });
// Values built inside the vm sandbox come from another realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('site URL prefers explicit config, then the Vercel production domain, never request headers', () => {
  const { siteUrl } = site();
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://shop.example/' }), 'https://shop.example');
  assert.equal(siteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'shop.vercel.app', VERCEL_URL: 'shop-abc.vercel.app' }), 'https://shop.vercel.app');
  assert.equal(siteUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'shop-abc.vercel.app' }), 'https://shop-abc.vercel.app');
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'javascript:alert(1)' }), 'http://localhost:3000');
  assert.equal(siteUrl({}), 'http://localhost:3000');
});

test('only production deployments are indexable', () => {
  const { isIndexable } = site();
  assert.equal(isIndexable({ VERCEL_ENV: 'production' }), true);
  assert.equal(isIndexable({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), false);
  assert.equal(isIndexable({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://shop.example' }), true);
  assert.equal(isIndexable({ NODE_ENV: 'production' }), false);
  assert.equal(isIndexable({ NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: 'https://shop.example' }), false);
});

test('server API base uses trusted configuration and gives up on protected previews', () => {
  const { serverApiBase } = site();
  assert.equal(serverApiBase({ INTERNAL_API_URL: 'http://backend:3001/api/', NEXT_PUBLIC_API_URL: 'http://localhost:3001/api' }), 'http://backend:3001/api');
  assert.equal(serverApiBase({ NEXT_PUBLIC_API_URL: 'https://api.shop.example/api' }), 'https://api.shop.example/api');
  assert.equal(serverApiBase({ NEXT_PUBLIC_API_URL: '/api', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'shop.vercel.app' }), 'https://shop.vercel.app/api');
  assert.equal(serverApiBase({ NEXT_PUBLIC_API_URL: '/api', VERCEL_ENV: 'preview', VERCEL_URL: 'shop-abc.vercel.app' }), null);
  assert.equal(serverApiBase({}), null);
});

test('API reads resolve to null on missing base, HTTP errors and network failures', async () => {
  const { fetchApiJson } = site();
  const env = { INTERNAL_API_URL: 'http://backend/api' };
  const calls = [];
  const ok = async (url) => { calls.push(url); return jsonResponse({ product: { title: 'A' } }); };
  assert.deepEqual(await fetchApiJson('/products/1', { env, fetcher: ok }), { product: { title: 'A' } });
  assert.deepEqual(calls, ['http://backend/api/products/1']);
  assert.equal(await fetchApiJson('/products/1', { env: {}, fetcher: ok }), null);
  assert.equal(await fetchApiJson('/products/1', { env, fetcher: async () => jsonResponse({ error: 'x' }, 404) }), null);
  assert.equal(await fetchApiJson('/products/1', { env, fetcher: async () => { throw new Error('down'); } }), null);
});

test('product listing pages through the API and stops at the cap or the first failure', async () => {
  const { listPublicProducts } = site();
  const env = { INTERNAL_API_URL: 'http://backend/api' };
  const pages = [];
  const fetcher = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    return jsonResponse({ products: [{ product_id: page * 10 }], totalPages: 3 });
  };
  assert.deepEqual(plain((await listPublicProducts({ env, fetcher })).map((p) => p.product_id)), [10, 20, 30]);
  assert.deepEqual(pages, [1, 2, 3]);
  pages.length = 0;
  assert.equal((await listPublicProducts({ env, fetcher, maxPages: 2 })).length, 2);
  const failing = async (url) => (new URL(url).searchParams.get('page') === '2' ? jsonResponse({}, 500) : fetcher(url));
  assert.equal((await listPublicProducts({ env, fetcher: failing })).length, 1);
});

test('descriptions are trimmed plain text and only absolute images are shared', () => {
  const { summarize, shareableImage } = site();
  assert.equal(summarize('  a\n\n b  ', 'fallback'), 'a b');
  assert.equal(summarize('', 'fallback'), 'fallback');
  assert.equal(summarize('x'.repeat(200), 'f', 10), `${'x'.repeat(9)}…`);
  assert.equal(shareableImage('https://img.example/a.png'), 'https://img.example/a.png');
  assert.equal(shareableImage('/uploads/a.png'), undefined);
  assert.equal(shareableImage('javascript:alert(1)'), undefined);
});

test('robots blocks everything outside production and keeps private paths out of the index', () => {
  const load = (env) => loadSource('src/app/robots.ts', {}, { '@/lib/site': { ...site(), isIndexable: () => site().isIndexable(env), siteUrl: () => site().siteUrl(env) } }).default();
  assert.deepEqual(plain(load({ VERCEL_ENV: 'preview' }).rules), { userAgent: '*', disallow: '/' });
  const prod = load({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'shop.vercel.app' });
  assert.equal(prod.sitemap, 'https://shop.vercel.app/sitemap.xml');
  for (const path of ['/admin', '/api', '/cart', '/orders', '/profile', '/login']) assert.ok(prod.rules.disallow.includes(path), path);
});

test('product metadata uses the product and falls back without breaking the page', async () => {
  const metadata = async (product, id = '7') => loadSource('src/app/products/[id]/layout.tsx', {}, {
    '@/lib/site': { ...site(), fetchApiJson: async () => (product === undefined ? null : { product }) },
  }).generateMetadata({ params: Promise.resolve({ id }) });

  const full = await metadata({ product_id: 7, title: '红色外套', description: '保暖\n舒适', price: '99.00', main_image: 'https://img.example/a.png' });
  assert.equal(full.title, '红色外套');
  assert.equal(full.description, '¥99.00 · 保暖 舒适');
  assert.equal(full.alternates.canonical, '/products/7');
  assert.equal(full.openGraph.images[0].url, 'https://img.example/a.png');
  assert.equal(full.twitter.card, 'summary_large_image');

  const offline = await metadata(undefined);
  assert.equal(offline.title, '商品详情');
  assert.equal(offline.alternates.canonical, '/products/7');

  const invalid = await metadata(undefined, '../admin');
  assert.equal(invalid.robots.index, false);
});

test('customer service pages only use translated copy and link to each other', () => {
  const english = Object.assign({}, ...['error', 'account', 'admin', 'common'].map((name) => loadSource(`src/lib/${name}-translations.ts`)[`${name}Translations`]));
  for (const route of ['help', 'returns', 'shipping']) {
    const element = loadSource(`src/app/${route}/page.tsx`, {}, { '@/components/InfoPage': function InfoPage() { return null; } }).default();
    const { title, intro, sections } = element.props;
    const strings = [title, intro, ...sections.flatMap((section) => [section.title, ...section.body])];
    for (const key of strings) assert.ok(Object.hasOwn(english, key), `${route}: untranslated ${key}`);
  }
});

test('footer links the service pages, contact details and coupon center', async () => {
  const tree = await loadPage('src/components/SiteFooter.tsx', {
    imports: { 'next/link': ({ href, children }) => ({ type: 'a', props: { href, children } }) },
    renderPage: (Footer) => Footer(),
  }).render();
  const hrefs = findElements(tree, (element) => element.props?.href).map((element) => element.props.href);
  for (const href of ['/help', '/returns', '/shipping', '/coupons', 'tel:4001234567', 'mailto:service@example.com']) {
    assert.ok(hrefs.includes(href), `missing ${href} in ${hrefs.join(', ')}`);
  }
});
