import { resolveTitle } from 'next/dist/lib/metadata/resolvers/resolve-title';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { preload } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import HelpPage from '@/app/help/page';
import { metadata as rootMetadata } from '@/app/layout';
import { metadata as adminLoginMetadata } from '@/app/admin/login/layout';
import { metadata as adminMetadata } from '@/app/admin/layout';
import { metadata as couponsMetadata } from '@/app/coupons/layout';
import { metadata as helpMetadata } from '@/app/help/layout';
import { metadata as orderDetailMetadata } from '@/app/orders/[id]/layout';
import { metadata as ordersMetadata } from '@/app/orders/layout';
import { metadata as homeMetadata } from '@/app/page';
import ProductLayout, { generateMetadata } from '@/app/products/[id]/layout';
import { metadata as productsMetadata } from '@/app/products/layout';
import { metadata as addressMetadata } from '@/app/profile/address/layout';
import { metadata as profileMetadata } from '@/app/profile/layout';
import { metadata as settingsMetadata } from '@/app/profile/settings/layout';
import ReturnsPage from '@/app/returns/page';
import { metadata as returnsMetadata } from '@/app/returns/layout';
import robots from '@/app/robots';
import ShippingPage from '@/app/shipping/page';
import { metadata as shippingMetadata } from '@/app/shipping/layout';
import SiteFooter from '@/components/SiteFooter';
import { accountTranslations } from '@/lib/account-translations';
import { adminTranslations } from '@/lib/admin-translations';
import { commonTranslations } from '@/lib/common-translations';
import { errorTranslations } from '@/lib/error-translations';
import {
  TITLE_TEMPLATE, fetchApiJson, fetchApiResult, isIndexable, listPublicProducts, serverApiBase, shareableImage, siteUrl, summarize,
  type ApiResult, type PublicProduct,
} from '@/lib/site';
import { render } from './helpers';

const NOT_FOUND = vi.hoisted(() => new Error('NEXT_NOT_FOUND'));
vi.mock('next/navigation', () => ({ notFound: () => { throw NOT_FOUND; }, usePathname: () => '/' }));
vi.mock('next/font/google', () => ({ Inter: () => ({ className: 'inter' }) }));
vi.mock('@/components/AppShell', () => ({ default: () => null }));
vi.mock('react-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-dom')>(), preload: vi.fn() }));
// The product layout reads through fetchApiResult; its own tests below run the real implementation.
vi.mock('@/lib/site', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/site')>();
  return { ...actual, fetchApiResult: vi.fn(actual.fetchApiResult) };
});

type Fetcher = typeof fetch;
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const backend = { INTERNAL_API_URL: 'http://backend/api' };

describe('site configuration', () => {
  it('prefers the explicit URL, then the Vercel production domain, never request headers', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://shop.example/' })).toBe('https://shop.example');
    expect(siteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'shop.vercel.app', VERCEL_URL: 'shop-abc.vercel.app' })).toBe('https://shop.vercel.app');
    expect(siteUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'shop-abc.vercel.app' })).toBe('https://shop-abc.vercel.app');
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'javascript:alert(1)' })).toBe('http://localhost:3000');
    expect(siteUrl({})).toBe('http://localhost:3000');
  });

  it('makes only production deployments indexable', () => {
    expect(isIndexable({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isIndexable({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(false);
    expect(isIndexable({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://shop.example' })).toBe(true);
    expect(isIndexable({ NODE_ENV: 'production' })).toBe(false);
    expect(isIndexable({ NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: 'https://shop.example' })).toBe(false);
  });

  it('reads the server API base from trusted configuration and gives up on protected previews', () => {
    expect(serverApiBase({ INTERNAL_API_URL: 'http://backend:3001/api/', NEXT_PUBLIC_API_URL: 'http://localhost:3001/api' })).toBe('http://backend:3001/api');
    expect(serverApiBase({ NEXT_PUBLIC_API_URL: 'https://api.shop.example/api' })).toBe('https://api.shop.example/api');
    expect(serverApiBase({ NEXT_PUBLIC_API_URL: '/api', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'shop.vercel.app' })).toBe('https://shop.vercel.app/api');
    expect(serverApiBase({ NEXT_PUBLIC_API_URL: '/api', VERCEL_ENV: 'preview', VERCEL_URL: 'shop-abc.vercel.app' })).toBeNull();
    expect(serverApiBase({})).toBeNull();
  });
});

describe('server API reads', () => {
  it('resolve to null without a base, on HTTP errors and on network failures', async () => {
    const ok = vi.fn<Fetcher>(async () => jsonResponse({ product: { title: 'A' } }));

    expect(await fetchApiJson('/products/1', { env: backend, fetcher: ok })).toEqual({ product: { title: 'A' } });
    expect(ok.mock.calls.map(([url]) => url)).toEqual(['http://backend/api/products/1']);
    expect(await fetchApiJson('/products/1', { env: {}, fetcher: ok })).toBeNull();
    expect(await fetchApiJson('/products/1', { env: backend, fetcher: async () => jsonResponse({ error: 'x' }, 404) })).toBeNull();
    expect(await fetchApiJson('/products/1', { env: backend, fetcher: async () => { throw new Error('down'); } })).toBeNull();
  });

  it('pages through successful product listings and respects the configured cap', async () => {
    const pages: number[] = [];
    const fetcher: Fetcher = async url => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      pages.push(page);
      return jsonResponse({ products: [{ product_id: page * 10 }], totalPages: 3 });
    };

    expect((await listPublicProducts({ env: backend, fetcher })).map(item => item.product_id)).toEqual([10, 20, 30]);
    expect(pages).toEqual([1, 2, 3]);
    expect(await listPublicProducts({ env: backend, fetcher, maxPages: 2 })).toHaveLength(2);
  });

  it.each([1, 2])('rejects a failed page %s instead of publishing a truncated sitemap', async failedPage => {
    const fetcher: Fetcher = async url => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return page === failedPage ? jsonResponse({}, 503) : jsonResponse({ products: [{ product_id: page }], totalPages: 3 });
    };
    await expect(listPublicProducts({ env: backend, fetcher })).rejects.toThrow();
  });

  it.each([
    ['missing totalPages', { products: [{ product_id: 7 }] }],
    ['negative totalPages', { products: [{ product_id: 7 }], totalPages: -1 }],
    ['fractional totalPages', { products: [{ product_id: 7 }], totalPages: 1.5 }],
    ['string totalPages', { products: [{ product_id: 7 }], totalPages: 'unknown' }],
    ['nonempty zero-page catalogue', { products: [{ product_id: 7 }], totalPages: 0 }],
    ['empty nonzero-page catalogue', { products: [], totalPages: 2 }],
    ['missing product ID', { products: [{}], totalPages: 1 }],
    ['nonpositive product ID', { products: [{ product_id: 0 }], totalPages: 1 }],
    ['string product ID', { products: [{ product_id: '7' }], totalPages: 1 }],
  ])('rejects malformed product listings: %s', async (_, data) => {
    await expect(listPublicProducts({ env: backend, fetcher: async () => jsonResponse(data) })).rejects.toThrow();
  });

  it('accepts a genuinely empty catalog and can retry after a failed listing', async () => {
    expect(await listPublicProducts({ env: backend, fetcher: async () => jsonResponse({ products: [], totalPages: 0 }) })).toEqual([]);
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ products: [{ product_id: 7 }], totalPages: 1 }));
    await expect(listPublicProducts({ env: backend, fetcher })).rejects.toThrow();
    expect(await listPublicProducts({ env: backend, fetcher })).toEqual([{ product_id: 7 }]);
  });

  it('separate definite misses from an unavailable backend', async () => {
    const kind = async (fetcher: Fetcher, env: Record<string, string> = backend) => (await fetchApiResult('/products/1', { env, fetcher })).kind;

    expect(await kind(async () => jsonResponse({ product: {} }))).toBe('ok');
    expect(await kind(async () => jsonResponse({ error: '商品不存在' }, 404))).toBe('missing');
    expect(await kind(async () => jsonResponse({ error: '商品ID无效' }, 400))).toBe('missing');
    expect(await kind(async () => jsonResponse({ error: 'down' }, 503))).toBe('unavailable');
    expect(await kind(async () => { throw new Error('timeout'); })).toBe('unavailable');
    expect(await kind(async () => jsonResponse({}), {})).toBe('unavailable');
  });

  it('trim descriptions to plain text and share only absolute images', () => {
    expect(summarize('  a\n\n b  ', 'fallback')).toBe('a b');
    expect(summarize('', 'fallback')).toBe('fallback');
    expect(summarize('x'.repeat(200), 'f', 10)).toBe(`${'x'.repeat(9)}…`);
    expect(shareableImage('https://img.example/a.png')).toBe('https://img.example/a.png');
    expect(shareableImage('/uploads/a.png')).toBeUndefined();
    expect(shareableImage('javascript:alert(1)')).toBeUndefined();
  });
});

describe('robots', () => {
  it('blocks everything outside production', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('keeps private paths out of the production index', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'shop.vercel.app');

    const result = robots();

    expect(result.sitemap).toBe('https://shop.vercel.app/sitemap.xml');
    const { disallow } = result.rules as { disallow: string[] };
    for (const path of ['/admin', '/api', '/cart', '/orders', '/profile', '/login']) expect(disallow, path).toContain(path);
  });
});

describe('product layout', () => {
  const answer = (result: ApiResult<{ product?: PublicProduct }>) => vi.mocked(fetchApiResult).mockResolvedValue(result);
  const props = (id = '7') => ({ params: Promise.resolve({ id }) });

  it('builds metadata from the product and falls back only when the backend is unavailable', async () => {
    answer({ kind: 'ok', data: { product: { product_id: 7, title: '红色外套', description: '保暖\n舒适', price: '99.00', main_image: 'https://img.example/a.png' } } });
    const full = await generateMetadata(props());
    expect(full.title).toBe('红色外套');
    expect(full.description).toBe('¥99.00 · 保暖 舒适');
    expect(full.alternates?.canonical).toBe('/products/7');
    expect((full.openGraph?.images as { url: string }[])[0].url).toBe('https://img.example/a.png');
    expect((full.twitter as { card?: string }).card).toBe('summary_large_image');

    answer({ kind: 'unavailable' });
    const offline = await generateMetadata(props());
    expect(offline.title).toBe('商品详情');
    expect(offline.alternates?.canonical).toBe('/products/7');
    expect(offline.robots).toBeUndefined();

    answer({ kind: 'missing', status: 404 });
    await expect(generateMetadata(props())).rejects.toBe(NOT_FOUND);
    answer({ kind: 'ok', data: { product: { product_id: 1, title: 'x' } } });
    await expect(generateMetadata(props('../admin'))).rejects.toBe(NOT_FOUND);
  });

  it.each([
    ['a shareable URL', { product_id: 7, title: 'A', main_image: 'https://img.example/a.png' }, [['https://img.example/a.png', { as: 'image', fetchPriority: 'high' }]]],
    ['a script URL', { product_id: 7, title: 'A', main_image: 'javascript:alert(1)' }, []],
    ['no image', { product_id: 7, title: 'A', main_image: null }, []],
    ['an unavailable backend', null, []],
  ])('preloads the main image only for %s', async (_, product, expected) => {
    answer(product ? { kind: 'ok', data: { product: product as PublicProduct } } : { kind: 'unavailable' });

    await ProductLayout({ children: 'page', ...props() });

    expect(vi.mocked(preload).mock.calls).toEqual(expected);
  });

  it('returns a real 404 for missing, delisted and malformed products only', async () => {
    const layout = (result: ApiResult<{ product?: PublicProduct }>, id = '7') => {
      answer(result);
      return ProductLayout({ children: 'page', ...props(id) });
    };

    expect(await layout({ kind: 'ok', data: { product: { product_id: 7, title: 'A' } } })).toBe('page');
    expect(await layout({ kind: 'unavailable' })).toBe('page');
    await expect(layout({ kind: 'missing', status: 404 })).rejects.toBe(NOT_FOUND);
    await expect(layout({ kind: 'missing', status: 400 })).rejects.toBe(NOT_FOUND);
    for (const id of ['0', 'abc', '99999999999', '1.5']) await expect(layout({ kind: 'unavailable' }, id), id).rejects.toBe(NOT_FOUND);
  });
});

describe('customer service pages', () => {
  const english: Record<string, string> = { ...errorTranslations, ...accountTranslations, ...adminTranslations, ...commonTranslations };

  it.each([['help', HelpPage], ['returns', ReturnsPage], ['shipping', ShippingPage]] as const)('%s uses only translated copy', (_, Page) => {
    type InfoProps = { title: string; intro: string; sections: { title: string; body: string[] }[] };
    const { title, intro, sections } = (Page() as ReactElement<InfoProps>).props;
    for (const key of [title, intro, ...sections.flatMap(section => [section.title, ...section.body])]) {
      expect(Object.hasOwn(english, key), `untranslated ${key}`).toBe(true);
    }
  });

  it('are linked from the footer with the contact details and coupon center', () => {
    render(<SiteFooter />);
    const hrefs = Array.from(document.querySelectorAll('a'), link => link.getAttribute('href'));
    for (const href of ['/help', '/returns', '/shipping', '/coupons']) expect(hrefs).toContain(href);
    expect(hrefs).not.toContain('tel:4001234567');
    expect(hrefs).not.toContain('mailto:service@example.com');
  });
});

describe('page metadata', () => {
  it.each([
    ['/', homeMetadata], ['/products', productsMetadata], ['/coupons', couponsMetadata],
    ['/help', helpMetadata], ['/returns', returnsMetadata], ['/shipping', shippingMetadata],
  ] as [string, Metadata][])('declares its own canonical %s', (canonical, metadata) => {
    expect(metadata.alternates?.canonical).toBe(canonical);
  });

  it('never sets a canonical in the root layout', () => {
    expect(rootMetadata.alternates).toBeUndefined();
  });

  it.each([
    ['products', productsMetadata, '全部商品', 'iPhone 15 Pro'],
    ['order detail', ordersMetadata, '我的订单', orderDetailMetadata.title],
    ['address', profileMetadata, '个人中心', addressMetadata.title],
    ['settings', profileMetadata, '个人中心', settingsMetadata.title],
    ['admin login', adminMetadata, '管理后台', adminLoginMetadata.title],
  ] as [string, Metadata, string, Metadata['title']][])('keeps the site name in nested %s titles', (_, parentMetadata, parentTitle, childTitle) => {
    const parent = resolveTitle(parentMetadata.title, TITLE_TEMPLATE);
    expect(parent.absolute).toBe(`${parentTitle} | 电商平台`);
    expect(resolveTitle(childTitle, parent.template).absolute).toBe(`${childTitle} | 电商平台`);
  });
});
