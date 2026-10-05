import type { MetadataRoute } from 'next';
import { PRIVATE_PATHS, isIndexable, siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: { userAgent: '*', disallow: '/' } };
  const base = siteUrl();
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
