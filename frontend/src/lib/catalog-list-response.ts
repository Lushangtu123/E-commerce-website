import type { ProductList } from '@/lib/api/catalog';
import { readProductCards } from '@/lib/product-region-response';

/** COUNT and SELECT can race; validate pagination without demanding a full final page. */
export function readCatalogList(value: unknown, page: number, limit = 20): ProductList {
  const products = readProductCards(value, 'products', limit);
  const body = value as Record<string, unknown>;
  if (body.page !== page || body.limit !== limit || !Number.isSafeInteger(body.total) || Number(body.total) < 0 ||
      body.totalPages !== Math.ceil(Number(body.total) / limit)) throw new Error('Invalid catalog pagination');
  return { products, page, limit, total: body.total as number, totalPages: body.totalPages as number };
}
