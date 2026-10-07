import { resolveRouteData } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data';
import { createPatchedFetcher } from 'next/dist/server/lib/patch-fetch';
import ResponseCache from 'next/dist/server/response-cache';
import type { CachedFetchValue, CachedRouteKind, IncrementalResponseCache, IncrementalResponseCacheEntry } from 'next/dist/server/response-cache';
import type { RouteKind } from 'next/dist/server/route-kind';
import { describe, expect, it, vi } from 'vitest';
import * as sitemapRoute from '@/app/sitemap';
import { PUBLIC_STATIC_PATHS } from '@/lib/site';

const APP_ROUTE = 'APP_ROUTE' as CachedRouteKind.APP_ROUTE;
const APP_ROUTE_KIND = 'APP_ROUTE' as RouteKind.APP_ROUTE;
const productIds = (xml: string) => Array.from(xml.matchAll(/<loc>https:\/\/shop\.test\/products\/(\d+)<\/loc>/g), match => Number(match[1]));

/** Run the real sitemap, Next fetch cache and XML response cache entirely in memory. */
function sitemapServer() {
  const fetchEntries = new Map<string, CachedFetchValue>();
  let fetchStale = false;
  let failedPage = 0;
  let count = 101;
  let routeEntry: IncrementalResponseCacheEntry | null = null;
  const upstream = vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    if (page === failedPage) return Response.json({ error: 'Temporary outage' }, { status: 503 });
    const start = (page - 1) * 100;
    const products = Array.from({ length: Math.max(0, Math.min(100, count - start)) }, (_, index) => ({
      product_id: start + index + 1, title: `Product ${start + index + 1}`,
    }));
    return Response.json({ products, total: count, page, limit: 100, totalPages: Math.ceil(count / 100) });
  });
  const fetchCache = {
    generateCacheKey: async (url: string) => url,
    lock: async () => () => {},
    get: async (key: string) => fetchEntries.has(key) ? { value: fetchEntries.get(key), isStale: fetchStale } : null,
    set: async (key: string, value: CachedFetchValue) => { fetchEntries.set(key, value); },
  };
  const newStores = () => ({
    work: {
      route: '/sitemap.xml', page: '/sitemap.xml/route', isStaticGeneration: true,
      forceStatic: (sitemapRoute as typeof sitemapRoute & { dynamic?: string }).dynamic === 'force-static',
      incrementalCache: fetchCache, pendingRevalidates: {} as Record<string, Promise<unknown>>,
    },
    unit: { type: 'prerender-legacy', phase: 'action', revalidate: sitemapRoute.revalidate, tags: [], implicitTags: { tags: [] } },
  });
  let stores = newStores();
  type FetchContext = Parameters<typeof createPatchedFetcher>[1];
  vi.stubGlobal('fetch', createPatchedFetcher(upstream, {
    workAsyncStorage: { getStore: () => stores.work },
    workUnitAsyncStorage: { getStore: () => stores.unit },
  } as unknown as FetchContext));
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('INTERNAL_API_URL', 'http://backend.test/api');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.test');

  const owner = { kind: APP_ROUTE_KIND, sourceRoute: '/sitemap.xml/route' };
  const responseCache = new ResponseCache({ minimalMode: false, route: owner });
  const incrementalCache: IncrementalResponseCache = {
    get: async () => routeEntry,
    set: async (_key, value, context) => { routeEntry = { value, cacheControl: context.cacheControl, isStale: false }; },
  };
  const cachedXML = () => routeEntry?.value?.kind === APP_ROUTE ? routeEntry.value.body.toString() : '';

  return {
    upstream,
    cachedXML,
    fetchCacheSize: () => fetchEntries.size,
    routeRevalidate: () => routeEntry?.cacheControl?.revalidate,
    setCount: (value: number) => { count = value; },
    failPage: (page: number) => { failedPage = page; },
    expire: (staleFetch = false) => { if (routeEntry) routeEntry.isStale = true; fetchStale = staleFetch; },
    async read() {
      const background: Promise<unknown>[] = [];
      const result = await responseCache.get('/sitemap.xml', async () => {
        stores = newStores();
        try {
          const xml = resolveRouteData(await sitemapRoute.default(), 'sitemap');
          return {
            value: { kind: APP_ROUTE, body: Buffer.from(xml), status: 200, headers: { 'content-type': 'application/xml' } },
            cacheControl: { revalidate: stores.unit.revalidate, expire: undefined },
          };
        } finally {
          await Promise.all(Object.values(stores.work.pendingRevalidates));
        }
      }, { routeKind: APP_ROUTE_KIND, incrementalCache, waitUntil: promise => { background.push(promise); } });
      await Promise.allSettled(background);
      if (result?.value?.kind !== APP_ROUTE) throw new Error('No sitemap XML response');
      return result.value.body.toString();
    },
  };
}

describe('sitemap regeneration through the Next caches', () => {
  it.each([false, true])('retains complete XML through a pagination outage and recovers (stale fetch cache: %s)', async staleFetch => {
    const server = sitemapServer();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const complete = await server.read();
    expect(productIds(complete)).toHaveLength(101);
    expect(server.routeRevalidate()).toBe(3600);
    server.failPage(2);
    server.expire(staleFetch);

    expect(await server.read() === complete).toBe(true);
    expect(server.upstream).toHaveBeenCalledTimes(4);
    expect(server.cachedXML() === complete).toBe(true);
    expect(errors).toHaveBeenCalledTimes(1);

    server.failPage(0);
    server.setCount(102);
    server.expire();
    await server.read();
    const recovered = await server.read();
    expect(productIds(recovered)).toHaveLength(102);
    expect(productIds(recovered).at(-1)).toBe(102);
    expect(server.routeRevalidate()).toBe(3600);
    expect(server.upstream).toHaveBeenCalledTimes(6);
    expect(server.fetchCacheSize()).toBe(0);
  });

  it('successfully caches a real empty catalogue without caching page data', async () => {
    const server = sitemapServer();
    server.setCount(0);
    const xml = await server.read();
    expect(productIds(xml)).toEqual([]);
    expect(Array.from(xml.matchAll(/<loc>/g))).toHaveLength(PUBLIC_STATIC_PATHS.length);
    expect(server.routeRevalidate()).toBe(3600);
    expect(await server.read()).toBe(xml);
    expect(server.upstream).toHaveBeenCalledTimes(1);
    expect(server.fetchCacheSize()).toBe(0);
  });

  it.each(['preview', 'development'])('returns no URLs without fetching the API when %s is not indexable', async environment => {
    const server = sitemapServer();
    server.setCount(0);
    vi.stubEnv('VERCEL_ENV', environment === 'preview' ? 'preview' : '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(await sitemapRoute.default()).toEqual([]);
    expect(server.upstream).not.toHaveBeenCalled();
  });
});
