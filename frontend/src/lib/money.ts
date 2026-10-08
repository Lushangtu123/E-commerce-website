/** Validate a DECIMAL(10,2) API amount without rounding malformed money into a valid amount. */
export function moneyToCents(value: number | string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value))) throw new RangeError('Invalid amount');
  const amount = Number(value), cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) ||
      cents > 9999999999 || Math.abs(amount - cents / 100) > 1e-9) throw new RangeError('Invalid amount');
  return cents;
}
