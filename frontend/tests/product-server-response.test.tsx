import { beforeEach, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import ProductDetail from '@/components/ProductDetail';
import { resolveProduct } from '@/app/products/[id]/product-data';
import { generateMetadata } from '@/app/products/[id]/layout';

const missing = vi.hoisted(() => new Error('Controlled notFound'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }), useParams: () => ({ id: '1' }), notFound: () => { throw missing; } }));
const product = { product_id: 1, title: 'Known item', description: 'Description', price: '10.00', stock: 3, sales_count: 0, rating: 0, status: 1 };
let body: unknown;
let status: number;
beforeEach(() => {
  body = { product }; status = 200;
  vi.stubEnv('INTERNAL_API_URL', 'http://isolated.test/api');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== 'http://isolated.test/api/products/1') throw new Error(`Unexpected mocked fetch ${url}`);
    return Response.json(body, { status });
  }));
});

it('keeps a null successful JSON body unavailable so the page can render and metadata can fall back', async () => {
  body = null;
  expect(await resolveProduct('1')).toBeNull();
  const metadata = await generateMetadata({ params: Promise.resolve({ id: '1' }) });
  expect(metadata.title).toBe('商品详情'); expect(metadata.alternates?.canonical).toBe('/products/1');
  expect(() => renderToString(<ProductDetail initialProduct={null} />)).not.toThrow();
});

it.each([
  {}, { product: null }, { product: [] }, { product: { ...product, product_id: 2, title: 'Wrong product' } },
  { product: { ...product, title: {} } }, { product: { ...product, description: {} } },
  { product: { ...product, price: '1e2' } }, { product: { ...product, stock: undefined } },
  { success: false, product }, { error: 'Failed', product },
])('keeps malformed 200 response %j out of SSR and sharing metadata without asserting a 404', async response => {
  body = response;
  const actual = await resolveProduct('1'); expect(actual).toBeNull();
  const metadata = await generateMetadata({ params: Promise.resolve({ id: '1' }) });
  expect(metadata.title).toBe('商品详情'); expect(metadata.alternates?.canonical).toBe('/products/1');
  expect(metadata.openGraph).toBeUndefined(); expect(metadata.robots).toBeUndefined();
  expect(() => renderToString(<ProductDetail initialProduct={actual} />)).not.toThrow();
});

it('keeps the valid requested product, its real pre-render and descriptive sharing metadata', async () => {
  expect(await resolveProduct('1')).toEqual(product);
  expect(renderToString(<ProductDetail initialProduct={product} />)).toContain(product.title);
  const metadata = await generateMetadata({ params: Promise.resolve({ id: '1' }) });
  expect(metadata.title).toBe(product.title); expect(metadata.description).toBe('¥10.00 · Description');
});

it('preserves a valid sold-out variant product instead of classifying it as missing', async () => {
  body = { product: { ...product, stock: 0, has_sku: true, skus: [] } };
  expect(await resolveProduct('1')).toEqual((body as { product: unknown }).product);
});

it.each([400, 404])('retains real notFound for HTTP %s', async code => {
  status = code; await expect(resolveProduct('1')).rejects.toBe(missing);
});

it('retains unavailable metadata for HTTP 503', async () => {
  status = 503; expect(await resolveProduct('1')).toBeNull();
  expect((await generateMetadata({ params: Promise.resolve({ id: '1' }) })).title).toBe('商品详情');
});
