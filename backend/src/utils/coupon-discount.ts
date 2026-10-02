export interface CouponDiscountRule {
  type: number;
  discount_value: number | string;
  min_amount: number | string;
  max_discount?: number | string | null;
}

const MAX_AMOUNT_CENTS = 9999999999;

/** Convert a DECIMAL(10,2) value without rounding invalid input into valid money. */
export function couponMoneyToCents(value: number | string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value))) {
    throw new RangeError('金额必须为非负数，最多两位小数');
  }
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) ||
      cents > MAX_AMOUNT_CENTS || Math.abs(amount - cents / 100) > 1e-9) {
    throw new RangeError('金额必须为非负数，最多两位小数');
  }
  return cents;
}

/**
 * discount_value is the percentage removed: 20 means 20% off (8折).
 * For compatibility, a null, omitted or zero max_discount means no discount cap.
 */
export function calculateDiscountCents(coupon: CouponDiscountRule, orderCents: number): number {
  if (!Number.isSafeInteger(orderCents) || orderCents < 0 || orderCents > MAX_AMOUNT_CENTS) {
    throw new RangeError('订单金额无效');
  }
  if (![1, 2, 3].includes(coupon.type)) throw new RangeError('优惠券类型无效');
  const value = couponMoneyToCents(coupon.discount_value);
  const minimum = couponMoneyToCents(coupon.min_amount);
  const maximum = coupon.max_discount == null ? 0 : couponMoneyToCents(coupon.max_discount);
  if (value <= 0 || (coupon.type === 2 && value > 10000)) throw new RangeError('优惠值无效');
  if (coupon.type === 3 && minimum !== 0) throw new RangeError('无门槛券最低金额必须为0');
  if (orderCents < minimum) return 0;

  let discount = coupon.type === 2 ? Math.round(orderCents * value / 10000) : value;
  if (coupon.type === 2 && maximum > 0) discount = Math.min(discount, maximum);
  return Math.min(discount, orderCents);
}
