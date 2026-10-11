import type { ExpectedCheckoutQuote, OrderPreview } from '@/lib/api/orders';

const MAX_AMOUNT = 99999999.99;
const MAX_COUPON_ID = 2147483647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCouponId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_COUPON_ID;
}

function isCoupon(value: unknown): value is NonNullable<OrderPreview['coupon']> & Record<string, unknown> {
  return isRecord(value) && isCouponId(value.user_coupon_id) &&
    typeof value.name === 'string' && typeof value.code === 'string';
}

function moneyCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (cents === 0 && value !== 0) return null;
  // Permit representation noise from valid cent amounts, without rounding sub-cent input into money.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2;
  return Number.isSafeInteger(cents) && Math.abs(scaled - cents) <= tolerance ? cents : null;
}

/** Pending retries preserve the exact amounts the shopper confirmed, including zero totals. */
export function validExpectedQuote(data: unknown): data is ExpectedCheckoutQuote {
  if (!isRecord(data) || Object.keys(data).length !== 3 ||
      !Object.keys(data).every(key => ['original_amount', 'discount_amount', 'total_amount'].includes(key))) return false;
  const original = moneyCents(data.original_amount);
  const discount = moneyCents(data.discount_amount);
  const total = moneyCents(data.total_amount);
  return original !== null && discount !== null && total !== null && discount <= original && total === original - discount;
}

/** Validate the complete server quote against the coupon requested for this preview. */
export function validOrderPreview(data: unknown, expectedCouponId?: number): data is OrderPreview {
  if (!isRecord(data) || data.success === false || (data.error !== undefined && data.error !== null)) return false;
  const original = moneyCents(data.original_amount);
  const discount = moneyCents(data.discount_amount);
  const total = moneyCents(data.total_amount);
  if (original === null || discount === null || total === null || discount > original ||
      total !== original - discount || !Array.isArray(data.available_coupons)) return false;

  const ids = new Set<number>();
  let selected: { name: string; code: string; discountCents: number } | undefined;
  for (const entry of data.available_coupons) {
    if (!isCoupon(entry) || ids.has(entry.user_coupon_id)) return false;
    const entryDiscount = moneyCents(entry.discount_amount);
    if (entryDiscount === null || entryDiscount > original) return false;
    ids.add(entry.user_coupon_id);
    if (entry.user_coupon_id === expectedCouponId) {
      selected = { name: entry.name, code: entry.code, discountCents: entryDiscount };
    }
  }

  if (expectedCouponId === undefined) return data.coupon === null && discount === 0;
  return isCouponId(expectedCouponId) && isCoupon(data.coupon) &&
    data.coupon.user_coupon_id === expectedCouponId && selected !== undefined &&
    data.coupon.name === selected.name && data.coupon.code === selected.code && discount === selected.discountCents;
}
