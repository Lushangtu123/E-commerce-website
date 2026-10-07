// Server-side site helpers for metadata, robots and sitemap. Every URL comes from
// trusted configuration, never from request headers, so a forged Host header cannot
// redirect server-side fetches.

export const SITE_NAME = '电商平台';
/** A layout with a plain string title drops this template for its children, so they repeat it. */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;
export const SITE_DESCRIPTION = '浏览精选商品，便捷下单，在线查看订单物流与售后申请进度。';

type Env = Record<string, string | undefined>;

const trimSlash = (value: string) => value.replace(/\/+$/, '');
const isHttpUrl = (value: string) => /^https?:\/\/[^/]+/.test(value);

/** Public origin used for canonical URLs, Open Graph and the sitemap. */
export function siteUrl(env: Env = process.env): string {
  if (env.NEXT_PUBLIC_SITE_URL && isHttpUrl(env.NEXT_PUBLIC_SITE_URL)) return trimSlash(env.NEXT_PUBLIC_SITE_URL);
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${trimSlash(env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  if (env.VERCEL_URL) return `https://${trimSlash(env.VERCEL_URL)}`;
  return 'http://localhost:3000';
}

/** Only production may be indexed; previews and local builds stay out of search engines. */
export function isIndexable(env: Env = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production' && Boolean(env.NEXT_PUBLIC_SITE_URL);
}

/**
 * API base for server-side reads. INTERNAL_API_URL lets containers reach the backend
 * by service name; otherwise an absolute NEXT_PUBLIC_API_URL is used, and the embedded
 * Vercel API is reached through the public production domain. Preview deployment URLs
 * sit behind Vercel authentication, so they return null and callers fall back.
 */
export function serverApiBase(env: Env = process.env): string | null {
  for (const candidate of [env.INTERNAL_API_URL, env.NEXT_PUBLIC_API_URL]) {
    if (candidate && isHttpUrl(candidate)) return trimSlash(candidate);
  }
  const relative = env.NEXT_PUBLIC_API_URL && env.NEXT_PUBLIC_API_URL.startsWith('/') ? env.NEXT_PUBLIC_API_URL : '/api';
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${trimSlash(env.VERCEL_PROJECT_PRODUCTION_URL)}${trimSlash(relative)}`;
  }
  return null;
}

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  /** The backend answered that the resource does not exist (404) or the id is invalid (400). */
  | { kind: 'missing'; status: number }
  /** No usable answer: no API base, network error, timeout or a server error. */
  | { kind: 'unavailable' };

/**
 * GET JSON from the backend with a short timeout. Distinguishes a definite "missing"
 * answer from an unavailable backend, so callers never treat an outage as a 404.
 */
export async function fetchApiResult<T>(path: string, options: { revalidate?: number; env?: Env; fetcher?: typeof fetch } = {}): Promise<ApiResult<T>> {
  const base = serverApiBase(options.env);
  if (!base) return { kind: 'unavailable' };
  try {
    const response = await (options.fetcher ?? fetch)(`${base}${path}`, {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: options.revalidate ?? 300 },
    } as RequestInit);
    if (response.status === 404 || response.status === 400) return { kind: 'missing', status: response.status };
    if (!response.ok) return { kind: 'unavailable' };
    return { kind: 'ok', data: (await response.json()) as T };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** GET JSON from the backend; anything but a successful answer resolves to null. */
export async function fetchApiJson<T>(path: string, options: { revalidate?: number; env?: Env; fetcher?: typeof fetch } = {}): Promise<T | null> {
  const result = await fetchApiResult<T>(path, options);
  return result.kind === 'ok' ? result.data : null;
}

export interface PublicProduct {
  product_id: number;
  title: string;
  description?: string | null;
  price?: number | string;
  main_image?: string | null;
  status?: number;
  updated_at?: string;
}

/** Plain-text summary for meta descriptions (search engines show roughly 120 CJK characters). */
export function summarize(text: string | null | undefined, fallback: string, max = 120): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Only absolute http(s) image URLs are safe to advertise in Open Graph tags. */
export function shareableImage(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

/** Paths that are personal, transactional or administrative and must not be crawled. */
export const PRIVATE_PATHS = ['/admin', '/api', '/cart', '/orders', '/profile', '/my', '/favorites', '/history', '/login', '/register', '/forgot-password', '/reset-password'];

/** Public pages that are always listed in the sitemap. */
export const PUBLIC_STATIC_PATHS = ['/', '/products', '/coupons', '/help', '/returns', '/shipping'];

/** Read fresh pages; a failed page must not replace the sitemap's complete ISR result. */
export async function listPublicProducts(options: { env?: Env; fetcher?: typeof fetch; maxPages?: number } = {}): Promise<PublicProduct[]> {
  const products: PublicProduct[] = [];
  const maxPages = options.maxPages ?? 50;
  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchApiResult<{ products?: PublicProduct[]; totalPages?: number }>(`/products?page=${page}&limit=100`, { env: options.env, fetcher: options.fetcher, revalidate: 0 });
    if (result.kind !== 'ok' || !Array.isArray(result.data?.products)) {
      throw new Error('Unable to load a complete product sitemap');
    }
    products.push(...result.data.products);
    if (!result.data.totalPages || page >= result.data.totalPages) break;
  }
  return products;
}
