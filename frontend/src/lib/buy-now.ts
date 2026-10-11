import type { CartInput } from '@/lib/api/orders';

export interface BuyNowIntent { id: string; input: CartInput; ready: boolean }
const storageKey = (sessionId: string, userId: number) => `buy-now:${sessionId}:${userId}`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** An explicit per-tab purchase; its UUID also keeps a revisited checkout idempotent. */
export function readBuyNow(sessionId: string, userId: number, id: string): BuyNowIntent | null {
  if (!uuid.test(id)) return null;
  const raw = sessionStorage.getItem(storageKey(sessionId, userId));
  if (raw === null) return null;
  const intent = JSON.parse(raw) as BuyNowIntent;
  const input = intent?.input;
  if (!intent || intent.id !== id || intent.ready !== true || !input ||
    !Number.isSafeInteger(input.product_id) || input.product_id <= 0 || input.product_id > 2147483647 ||
    !Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2147483647 ||
    (input.sku_id !== undefined && (!Number.isSafeInteger(input.sku_id) || input.sku_id <= 0 || input.sku_id > 2147483647))) return null;
  return intent;
}

export function storeBuyNow(sessionId: string, userId: number, intent: BuyNowIntent) {
  try { sessionStorage.setItem(storageKey(sessionId, userId), JSON.stringify(intent)); }
  catch { throw new Error('无法保存本次购买，请恢复浏览器存储后重试'); }
}

export function clearBuyNow(sessionId: string, userId: number, id: string) {
  try {
    if (JSON.parse(sessionStorage.getItem(storageKey(sessionId, userId)) || 'null')?.id === id) sessionStorage.removeItem(storageKey(sessionId, userId));
  } catch { /* The immutable UUID still prevents a revisited intent from creating a second order. */ }
}
