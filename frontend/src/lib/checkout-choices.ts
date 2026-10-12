/** Per-tab, per-session and per-purchase identifiers; never addresses or quoted prices. */
export interface CheckoutChoices { addressId?: number | null; couponId?: number | null }
const key = (sessionKey: string, purchaseId: string | null) => `checkout-choices:${JSON.stringify([sessionKey, purchaseId])}`;
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;

export function readCheckoutChoices(sessionKey: string, purchaseId: string | null): CheckoutChoices {
  const raw = sessionStorage.getItem(key(sessionKey, purchaseId));
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(field => !['addressId', 'couponId'].includes(field)) ||
      ('addressId' in value && value.addressId !== null && !validId(value.addressId)) ||
      ('couponId' in value && value.couponId !== null && !validId(value.couponId))) throw new Error('Invalid checkout choices');
  return value;
}

export function storeCheckoutChoices(sessionKey: string, purchaseId: string | null, choices: CheckoutChoices): boolean {
  try {
    const raw = JSON.stringify(choices);
    sessionStorage.setItem(key(sessionKey, purchaseId), raw);
    return sessionStorage.getItem(key(sessionKey, purchaseId)) === raw;
  } catch { return false; }
}

export function clearCheckoutChoices(sessionKey: string, purchaseId: string | null): void {
  try { sessionStorage.removeItem(key(sessionKey, purchaseId)); } catch { /* Confirmed orders must still navigate if storage becomes unavailable. */ }
}
