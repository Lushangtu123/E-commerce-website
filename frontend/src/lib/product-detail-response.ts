import type { Product } from '@/lib/api/catalog';
import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0 && value <= 2147483647;
const text = (value: unknown) => value == null || typeof value === 'string';
function money(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  try { moneyToCents(value); return true; } catch { return false; }
}
function rating(value: unknown) {
  return (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) &&
    Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5;
}
function translations(value: unknown) {
  return value == null || (record(value) && Object.values(value).every(translation => record(translation) &&
    ['name', 'value'].every(field => translation[field] === undefined || typeof translation[field] === 'string')));
}

/** Only the requested product's usable catalog snapshot can unlock its controls. */
export function validProductDetailResponse(value: unknown, productId: number): value is { product: Product } {
  if (!record(value) || value.success === false || value.error != null || !record(value.product)) return false;
  const product = value.product;
  // Variant products expose summed inventory, which can exceed one SKU's SQL INT limit.
  if (!id(productId) || product.product_id !== productId || typeof product.title !== 'string' || product.title.trim() === '' ||
      !money(product.price) || !count(product.stock) || !count(product.sales_count) || !rating(product.rating) ||
      (product.status !== undefined && product.status !== 1) || (product.review_count !== undefined && !count(product.review_count)) ||
      !['title_en', 'description', 'description_en', 'main_image'].every(field => text(product[field])) ||
      (product.original_price != null && !money(product.original_price)) || (product.specs != null && !record(product.specs)) ||
      !translations(product.specs_en) ||
      (product.has_sku !== undefined && ![false, true, 0, 1].includes(product.has_sku as boolean | number))) return false;
  const hasSKU = product.has_sku === true || product.has_sku === 1;
  if (product.skus === undefined) return !hasSKU;
  if (!Array.isArray(product.skus) || (!hasSKU && product.skus.length > 0)) return false;
  const ids = new Set<number>();
  return product.skus.every(sku => {
    if (!record(sku) || !id(sku.sku_id) || ids.has(sku.sku_id) || sku.product_id !== productId ||
        sku.status !== 1 || typeof sku.sku_code !== 'string' || sku.sku_code.trim() === '' ||
        !money(sku.price) || !count(sku.stock) || sku.stock > 2147483647 ||
        (sku.original_price != null && !money(sku.original_price)) || !text(sku.image) ||
        !record(sku.specs) || !Object.values(sku.specs).every(spec => typeof spec === 'string' || typeof spec === 'boolean' ||
          (typeof spec === 'number' && Number.isFinite(spec))) || !translations(sku.specs_en)) return false;
    ids.add(sku.sku_id); return true;
  });
}
