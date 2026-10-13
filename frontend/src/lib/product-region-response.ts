import type { Product, ProductReview } from '@/lib/api/catalog';
import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0 && value <= 2147483647;
const text = (value: unknown) => value == null || typeof value === 'string';
const stock = (value: unknown) => count(value) || (typeof value === 'string' && /^\d+(?:\.0+)?$/.test(value) && count(Number(value)));
const rating = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5;

/** A missing review collection is a failed read, not an empty page. */
export function readProductReviews(value: unknown, productId: number, page: number, limit = 5): { reviews: ProductReview[]; total: number; totalPages: number } {
  if (!record(value) || value.success === false || value.error != null || !id(productId) || !count(page) || page < 1 ||
      !count(limit) || limit < 1 || limit > 100 || !Array.isArray(value.reviews) || value.reviews.length > limit || !count(value.total) ||
      (value.page !== undefined && value.page !== page) || (value.limit !== undefined && value.limit !== limit) ||
      (value.totalPages !== undefined && value.totalPages !== Math.ceil(value.total / limit))) throw new Error('Invalid product reviews');
  const ids = new Set<number>();
  for (const review of value.reviews) {
    if (!record(review) || !id(review.review_id) || ids.has(review.review_id) ||
        (review.product_id !== undefined && review.product_id !== productId) ||
        !count(review.rating) || review.rating < 1 || review.rating > 5 ||
        !['username', 'content', 'created_at'].every(field => text(review[field])) ||
        (review.author_deleted !== undefined && typeof review.author_deleted !== 'boolean')) throw new Error('Invalid product review');
    ids.add(review.review_id);
  }
  return { reviews: value.reviews.map(review => ({ ...review, created_at: review.created_at ?? undefined })) as ProductReview[],
    total: value.total, totalPages: Math.ceil(value.total / limit) };
}

/** Catalog cards share one render contract; missing collections are failed reads, not empty results. */
export function readProductCards(value: unknown, collection: 'products' | 'recommendations' | 'related_products', limit: number): Product[] {
  if (!record(value) || value.success === false || value.error != null || !count(limit) || limit < 1 || limit > 100 ||
      !Array.isArray(value[collection]) || value[collection].length > limit) throw new Error('Invalid product cards');
  const products = value[collection];
  const ids = new Set<number>();
  for (const product of products) {
    if (!record(product) || !id(product.product_id) || ids.has(product.product_id) ||
        typeof product.title !== 'string' || product.title.trim() === '' || !text(product.title_en) || !text(product.main_image) ||
        !stock(product.stock) || !count(product.sales_count) || !rating(product.rating) ||
        (product.review_count !== undefined && !count(product.review_count)) || (product.status !== undefined && product.status !== 1) ||
        (product.has_sku !== undefined && ![false, true, 0, 1].includes(product.has_sku as boolean | number)) ||
        !['string', 'number'].includes(typeof product.price) ||
        (product.original_price != null && !['string', 'number'].includes(typeof product.original_price))) throw new Error('Invalid product card');
    moneyToCents(product.price as string | number);
    if (product.original_price != null) moneyToCents(product.original_price as string | number);
    ids.add(product.product_id);
  }
  // SUM(stock) arrives as a MySQL decimal string; cards receive the safe integer already checked above.
  return products.map(product => ({ ...product, stock: Number(product.stock) })) as Product[];
}

/** Related products additionally exclude the requested item and keep the endpoint's exact count. */
export function readRelatedProducts(value: unknown, productId: number, limit = 4): Product[] {
  const products = readProductCards(value, 'related_products', limit);
  if (!record(value) || !id(productId) || limit > 50 || products.some(product => product.product_id === productId) ||
      (value.total !== undefined && value.total !== products.length)) throw new Error('Invalid related products');
  return products;
}
