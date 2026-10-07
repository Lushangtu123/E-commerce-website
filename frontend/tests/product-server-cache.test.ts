import { createPatchedFetcher } from 'next/dist/server/lib/patch-fetch';
import type { CachedFetchValue } from 'next/dist/server/response-cache/types';
import { describe, expect, it, vi } from 'vitest';
import { resolveProduct } from '@/app/products/[id]/product-data';
import { fetchApiResult } from '@/lib/site';

const product = { product_id: 7, title: 'Shirt', price: '19.90', stock: 5, sales_count: 0, rating: 5, status: 1 };

/** Exercise Next's real fetch cache without a network server or filesystem cache. */
function productServer() {
  const entries = new Map<string, CachedFetchValue>();
  let stale = false;
  let status = 200;
  const upstream = vi.fn(async () => Response.json(status === 200 ? { product } : { error: '商品不存在' }, { status }));
  const incrementalCache = {
    generateCacheKey: async (url: string) => url,
    lock: async () => () => {},
    get: async (key: string) => entries.has(key) ? { value: entries.get(key), isStale: stale } : null,
    set: async (key: string, value: CachedFetchValue) => { entries.set(key, value); },
  };
  const newRequest = () => ({
    route: '/products/[id]', page: '/products/[id]/page', isStaticGeneration: false,
    incrementalCache, pendingRevalidates: {} as Record<string, Promise<unknown>>,
  });
  let request = newRequest();
  type FetchContext = Parameters<typeof createPatchedFetcher>[1];
  const fetcher = createPatchedFetcher(upstream, {
    workAsyncStorage: { getStore: () => request },
    workUnitAsyncStorage: { getStore: () => undefined },
  } as unknown as FetchContext);
  vi.stubEnv('INTERNAL_API_URL', 'http://backend.test/api');
  vi.stubGlobal('fetch', fetcher);

  return {
    upstream,
    setStatus: (value: number) => { status = value; },
    expireCache: () => { stale = true; },
    async read<T>(load: () => Promise<T>): Promise<T> {
      request = newRequest();
      try {
        return await load();
      } finally {
        await Promise.all(Object.values(request.pendingRevalidates));
      }
    },
  };
}

describe('server product availability through the Next fetch cache', () => {
  it('control: a cached 200 survives an upstream 404 even after revalidation', async () => {
    const server = productServer();
    const read = () => server.read(() => fetchApiResult('/products/7'));
    expect((await read()).kind).toBe('ok');
    server.setStatus(404);
    expect((await read()).kind).toBe('ok');
    expect(server.upstream).toHaveBeenCalledTimes(1);

    server.expireCache();
    expect((await read()).kind).toBe('ok');
    expect((await read()).kind).toBe('ok');
    expect(server.upstream).toHaveBeenCalledTimes(3);
    expect(await server.read(() => fetchApiResult('/products/7', { revalidate: 0 }))).toEqual({ kind: 'missing', status: 404 });
  });

  it.each([false, true])('returns notFound after delisting a previously rendered product (expired cache: %s)', async expired => {
    const server = productServer();
    expect(await server.read(() => resolveProduct('7'))).toEqual(product);
    server.setStatus(404);
    if (expired) server.expireCache();

    await expect(server.read(() => resolveProduct('7'))).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(server.upstream).toHaveBeenCalledTimes(2);
  });

  it('keeps an unavailable backend distinct from a missing product', async () => {
    const server = productServer();
    server.setStatus(503);
    expect(await server.read(() => resolveProduct('7'))).toBeNull();
    expect(server.upstream).toHaveBeenCalledTimes(1);
  });
});
