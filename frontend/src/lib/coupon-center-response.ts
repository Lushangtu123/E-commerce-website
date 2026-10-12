import type { Coupon, CouponPagination } from '@/lib/api';
import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const quantity = (value: unknown): value is number => count(value) && value <= 2147483647;
const positiveInteger = (value: unknown): value is number => quantity(value) && value > 0;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const money = (value: unknown, positive = false) => {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  try {
    const cents = moneyToCents(value);
    return (cents !== 0 || Number(value) === 0) && (!positive || cents > 0);
  } catch { return false; }
};

/** Validate available-coupon reads before rows or claim controls enter the current page. */
export function readCouponCenterPage(value: unknown, page: number, pageSize = 50): { data: Coupon[]; pagination: CouponPagination } {
  if (!record(value) || value.success !== true || !Array.isArray(value.data) || value.data.length > pageSize ||
      !record(value.pagination) || value.pagination.page !== page || value.pagination.page_size !== pageSize ||
      !count(value.pagination.total) || !count(value.pagination.total_pages) ||
      value.pagination.total_pages !== Math.ceil(value.pagination.total / pageSize)) throw new Error('Invalid coupon center page');

  const ids = new Set<number>();
  for (const row of value.data) {
    if (!record(row) || !positiveInteger(row.coupon_id) || ids.has(row.coupon_id) ||
        typeof row.code !== 'string' || !row.code.trim() || typeof row.name !== 'string' || !row.name.trim() ||
        (row.description != null && typeof row.description !== 'string') || ![1, 2, 3].includes(row.type as number) || row.status !== 1 ||
        !money(row.discount_value, true) || (row.type === 2 && Number(row.discount_value) > 100) ||
        !money(row.min_amount) || (row.type === 3 && Number(row.min_amount) !== 0) || (row.max_discount != null && !money(row.max_discount)) ||
        !positiveInteger(row.total_quantity) || !quantity(row.remain_quantity) || row.remain_quantity > row.total_quantity ||
        !positiveInteger(row.per_user_limit) || !date(row.start_time) || !date(row.end_time) ||
        Date.parse(row.start_time as string) >= Date.parse(row.end_time as string)) throw new Error('Invalid coupon center page');
    ids.add(row.coupon_id);
  }
  // COUNT and rows are separate SQL reads; a concurrent claim may leave a shorter or empty page.
  // An empty requested page beyond the new last page must reach the page's existing correction.
  return { data: value.data as Coupon[], pagination: value.pagination as unknown as CouponPagination };
}
