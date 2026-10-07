import type { OrderCreateInput } from './api/orders';

export interface PendingCheckout { sessionKey: string; input: OrderCreateInput }
const STORAGE_KEY = 'pending-checkout';

/** Per-tab recovery state contains IDs only; a different sign-in must never reuse it. */
export function readPendingCheckout(sessionKey: string): PendingCheckout | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as PendingCheckout | null;
    const input = stored?.input;
    if (stored?.sessionKey !== sessionKey || !input || typeof input.checkout_key !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.checkout_key) ||
        !Number.isSafeInteger(input.shipping_address_id) || input.shipping_address_id <= 0 ||
        !Array.isArray(input.items) || !input.items.length || !input.items.every(item => item &&
          Number.isSafeInteger(item.product_id) && item.product_id > 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
          (item.sku_id === undefined || Number.isSafeInteger(item.sku_id) && item.sku_id > 0)) ||
        (input.user_coupon_id !== undefined && (!Number.isSafeInteger(input.user_coupon_id) || input.user_coupon_id <= 0))) return null;
    return stored;
  } catch { return null; }
}

export function storePendingCheckout(attempt: PendingCheckout): boolean {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt)); return true; }
  catch { return false; }
}

export function clearPendingCheckout(sessionKey: string): void {
  if (readPendingCheckout(sessionKey)) {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
  }
}
