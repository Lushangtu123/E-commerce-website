import type { CouponPagination, UserCoupon } from '@/lib/api';
import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is number => count(value) && value > 0;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const money = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  try { moneyToCents(value); return true; } catch { return false; }
};

/** Only the page and effective status requested by this account may become actionable. */
export function readMyCouponPage(value: unknown, status: number, page: number, userId: number | undefined, pageSize = 20): { data: UserCoupon[]; pagination: CouponPagination } {
  if (!record(value) || (value.success !== undefined && value.success !== true) || !Array.isArray(value.data) || value.data.length > pageSize ||
      !record(value.pagination) || value.pagination.page !== page || value.pagination.page_size !== pageSize ||
      !count(value.pagination.total) || !count(value.pagination.total_pages) || value.pagination.total_pages !== Math.ceil(value.pagination.total / pageSize)) {
    throw new Error('Invalid coupon page');
  }
  const ids = new Set<number>();
  for (const row of value.data) {
    if (!record(row) || !id(row.user_coupon_id) || ids.has(row.user_coupon_id) || !id(row.coupon_id) ||
        (row.user_id !== undefined && row.user_id !== userId) || row.status !== status || ![1, 2, 3].includes(row.type as number) ||
        typeof row.code !== 'string' || !row.code.trim() || typeof row.name !== 'string' || !row.name.trim() ||
        (row.description != null && typeof row.description !== 'string') || !money(row.discount_value) || !money(row.min_amount) ||
        (row.max_discount != null && !money(row.max_discount)) || !date(row.received_at) || !date(row.expired_at) ||
        (row.start_time !== undefined && !date(row.start_time)) || (row.end_time !== undefined && !date(row.end_time)) ||
        (row.used_at != null && !date(row.used_at)) ||
        (row.coupon_status !== undefined && ![0, 1].includes(row.coupon_status as number))) throw new Error('Invalid coupon page');
    ids.add(row.user_coupon_id);
  }
  return { data: value.data as UserCoupon[], pagination: value.pagination as unknown as CouponPagination };
}
