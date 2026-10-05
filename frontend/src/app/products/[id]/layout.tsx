import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { preload } from 'react-dom';
import { SITE_NAME, fetchApiResult, shareableImage, summarize, type ApiResult, type PublicProduct } from '@/lib/site';

const FALLBACK_TITLE = '商品详情';
const isProductId = (id: string) => /^[1-9]\d{0,9}$/.test(id);

/** One backend read per request, shared by metadata and the layout. */
const loadProduct = cache((id: string): Promise<ApiResult<{ product?: PublicProduct }>> =>
  fetchApiResult<{ product?: PublicProduct }>(`/products/${id}`));

/**
 * Deleted, delisted and malformed product URLs return a real 404. An unreachable API
 * renders the page normally, so an outage never removes real products from search.
 */
async function resolveProduct(id: string): Promise<PublicProduct | null> {
  if (!isProductId(id)) notFound();
  const result = await loadProduct(id);
  if (result.kind === 'missing') notFound();
  return result.kind === 'ok' && result.data.product?.title ? result.data.product : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await resolveProduct(id);
  const canonical = `/products/${id}`;
  if (!product) return { title: FALLBACK_TITLE, alternates: { canonical } };

  const price = product.price !== undefined && product.price !== null ? `¥${product.price} · ` : '';
  const description = `${price}${summarize(product.description, `${product.title} - ${SITE_NAME}`)}`;
  const image = shareableImage(product.main_image);
  const images = image ? [{ url: image, alt: product.title }] : undefined;

  return {
    title: product.title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'zh_CN', title: product.title, description, url: canonical, images },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: product.title, description, images: image ? [image] : undefined },
  };
}

// Metadata may stream after the response starts; the layout renders before it, so its
// notFound() is what gives browsers and crawlers an actual 404 status.
export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await resolveProduct(id);
  // The main image is the page's largest paint; start fetching it from the server HTML
  // instead of after hydration and the client-side product request.
  const image = shareableImage(product?.main_image);
  if (image) preload(image, { as: 'image', fetchPriority: 'high' });
  return children;
}
