import type { MetadataRoute } from 'next';
import { PUBLIC_STATIC_PATHS, listPublicProducts, siteUrl } from '@/lib/site';

// Rebuilt at most hourly so new products appear without a deployment.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: MetadataRoute.Sitemap = PUBLIC_STATIC_PATHS.map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: path === '/' || path === '/products' ? 'daily' : 'monthly',
    priority: path === '/' ? 1 : path === '/products' ? 0.9 : 0.5,
  }));
  const products = await listPublicProducts();
  return [
    ...pages,
    ...products.map((product) => ({
      url: `${base}/products/${product.product_id}`,
      lastModified: product.updated_at ? new Date(product.updated_at) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
