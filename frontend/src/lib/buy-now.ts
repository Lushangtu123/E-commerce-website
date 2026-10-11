import type { CartInput } from '@/lib/api/orders';
import type { Product } from '@/lib/api/catalog';
import type { CartItem } from '@/store/useCartStore';

export interface BuyNowIntent { id: string; input: CartInput; ready: boolean; source?: 'buy_now' }
const storageKey = (sessionId: string, userId: number) => `buy-now:${sessionId}:${userId}`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** An explicit per-tab purchase; its UUID also keeps a revisited checkout idempotent. */
export function readBuyNow(sessionId: string, userId: number, id: string): BuyNowIntent | null {
  if (!uuid.test(id)) return null;
  const raw = sessionStorage.getItem(storageKey(sessionId, userId));
  if (raw === null) return null;
  const intent = JSON.parse(raw) as BuyNowIntent;
  const input = intent?.input;
  if (!intent || intent.id !== id || intent.ready !== true || (intent.source !== undefined && intent.source !== 'buy_now') || !input ||
    !Number.isSafeInteger(input.product_id) || input.product_id <= 0 || input.product_id > 2147483647 ||
    !Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2147483647 ||
    (input.sku_id !== undefined && (!Number.isSafeInteger(input.sku_id) || input.sku_id <= 0 || input.sku_id > 2147483647))) return null;
  return intent;
}

/** Display a fresh catalog read; checkout still revalidates stock and price on the server. */
export function buyNowItem(product: Product, input: CartInput): CartItem | null {
  if (!product || product.product_id !== input.product_id || typeof product.title !== 'string' ||
      (product.status !== undefined && product.status !== 1)) return null;
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const sku = input.sku_id === undefined ? undefined : skus.find(value => value.sku_id === input.sku_id && value.status === 1);
  if (input.sku_id !== undefined && !sku || input.sku_id === undefined && (product.has_sku || skus.length > 0)) return null;
  const stock = (sku ?? product).stock, price = Number((sku ?? product).price);
  if (!Number.isSafeInteger(stock) || stock < input.quantity || !Number.isFinite(price) || price < 0) return null;
  return { cart_id: 0, ...input, title: product.title, title_en: product.title_en, price, stock, available: true,
    main_image: sku?.image || product.main_image, sku_code: sku?.sku_code, sku_specs: sku?.specs, sku_specs_en: sku?.specs_en };
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
