export const couponClaimKeyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export class CouponClaimError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export function normalizeCouponClaimKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !couponClaimKeyPattern.test(value)) throw new CouponClaimError('领取请求号无效，请刷新页面后重试');
  return value.toLowerCase();
}
