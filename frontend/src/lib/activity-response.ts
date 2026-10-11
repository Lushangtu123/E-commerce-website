import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0;
const text = (value: unknown) => value == null || typeof value === 'string';
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const stock = (value: unknown) => value === null || ((typeof value === 'number' ||
  (typeof value === 'string' && /^\d+(?:\.0+)?$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0);
const money = (value: unknown) => {
  if (value === null) return true;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  try { moneyToCents(value); return true; } catch { return false; }
};

/** A missing collection is not empty. Preserve nullable product fields of historical receipts. */
export function readActivityPage<T extends { product_id: number }>(value: unknown, collection: 'favorites' | 'history', page: number, userId: number | undefined, limit = 20): { rows: T[]; total: number; totalPages: number } {
  if (!record(value) || !Array.isArray(value[collection]) || !record(value.pagination)) throw new Error('Invalid activity list');
  const rows = value[collection], pagination = value.pagination;
  if (rows.length > limit || pagination.page !== page || pagination.limit !== limit || !count(pagination.total) ||
      !count(pagination.total_pages) || pagination.total_pages !== Math.ceil(pagination.total / limit)) throw new Error('Invalid activity list');
  const ids = new Set<number>(), products = new Set<number>();
  for (const row of rows) {
    const receiptId = record(row) ? row[collection === 'favorites' ? 'favorite_id' : 'id'] : undefined;
    if (!record(row) || !id(receiptId) || ids.has(receiptId) || !id(row.product_id) || products.has(row.product_id) ||
        (row.user_id !== undefined && row.user_id !== userId) || !Object.hasOwn(row, 'title') || !text(row.title) ||
        !text(row.title_en) || !text(row.main_image) || !money(row.price) || (row.original_price != null && !money(row.original_price)) || !stock(row.stock) ||
        ![null, -1, 0, 1].includes(row.status as number | null) || ![undefined, null, false, true, 0, 1].includes(row.has_sku as boolean | number | null | undefined) ||
        (collection === 'history' && !date(row.browsed_at)) || (row.created_at !== undefined && !date(row.created_at))) throw new Error('Invalid activity list');
    ids.add(receiptId); products.add(row.product_id);
  }
  return { rows: rows as T[], total: pagination.total, totalPages: pagination.total_pages };
}
