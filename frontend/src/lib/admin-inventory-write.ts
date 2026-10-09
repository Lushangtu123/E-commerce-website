import type { AdminPage, AdminProductRow } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';

/** A response may be lost after the inventory transaction committed. */
export function unknownInventoryWrite(error: unknown) {
  const status = requestFailure(error).response?.status;
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function inventoryUpdateAcknowledged(value: unknown): value is { message: string } {
  return !!value && typeof value === 'object' && 'message' in value && value.message === '更新成功';
}

export type AdminProductSnapshot = AdminPage & { products: AdminProductRow[] };
/** Only a usable current snapshot can release an uncertain inventory operation. */
export function validProductSnapshot(value: unknown): value is AdminProductSnapshot {
  if (!value || typeof value !== 'object' || !('products' in value) || !Array.isArray(value.products) ||
      !('pagination' in value) || !value.pagination || typeof value.pagination !== 'object' || !('total' in value.pagination) ||
      !Number.isSafeInteger(value.pagination.total) || Number(value.pagination.total) < 0) return false;
  const ids = new Set<number>();
  return value.products.every(row => {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.product_id) || row.product_id <= 0 || row.product_id > 2147483647 ||
        ids.has(row.product_id) || typeof row.title !== 'string' || ![-1, 0, 1].includes(row.status) ||
        !Number.isSafeInteger(row.stock) || row.stock < 0 || row.stock > 2147483647 ||
        !((typeof row.price === 'number' || (typeof row.price === 'string' && row.price.trim() !== '')) &&
          Number.isFinite(Number(row.price)) && Number(row.price) >= 0 && Number(row.price) <= 99999999.99) ||
        !['title_en', 'description', 'description_en', 'brand', 'main_image'].every(field => row[field] == null || typeof row[field] === 'string') ||
        !(row.category_id == null || (Number.isSafeInteger(row.category_id) && row.category_id > 0 && row.category_id <= 2147483647))) return false;
    ids.add(row.product_id); return true;
  });
}
