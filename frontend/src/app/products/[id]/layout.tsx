import type { Metadata } from 'next';
import { SITE_NAME, fetchApiJson, shareableImage, summarize, type PublicProduct } from '@/lib/site';

const FALLBACK_TITLE = '商品详情';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) return { title: FALLBACK_TITLE, robots: { index: false, follow: false } };

  const canonical = `/products/${id}`;
  const data = await fetchApiJson<{ product?: PublicProduct }>(`/products/${id}`);
  const product = data?.product;
  // Unavailable API (e.g. protected preview deployments) keeps the generic title.
  if (!product?.title) return { title: FALLBACK_TITLE, alternates: { canonical } };

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

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
