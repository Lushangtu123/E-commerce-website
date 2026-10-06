import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Product } from '@/lib/api';
import { fetchApiResult, type ApiResult } from '@/lib/site';

const isProductId = (id: string) => /^[1-9]\d{0,9}$/.test(id);

/** One backend read per request, shared by metadata, the layout and the page. */
const loadProduct = cache((id: string): Promise<ApiResult<{ product?: Product }>> =>
  fetchApiResult<{ product?: Product }>(`/products/${id}`));

/**
 * Deleted, delisted and malformed product URLs return a real 404. An unreachable API
 * renders the page normally, so an outage never removes real products from search.
 */
export async function resolveProduct(id: string): Promise<Product | null> {
  if (!isProductId(id)) notFound();
  const result = await loadProduct(id);
  if (result.kind === 'missing') notFound();
  return result.kind === 'ok' && result.data.product?.title ? result.data.product : null;
}
