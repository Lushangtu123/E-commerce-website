import { cartItemKey, type CartItem } from '@/store/useCartStore';

export function validCartItems(value: unknown): value is CartItem[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  return value.every(item => {
    if (!item || !Number.isSafeInteger(item.cart_id) || item.cart_id < 1 || !Number.isSafeInteger(item.product_id) || item.product_id < 1 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.stock) || item.stock < 0 || typeof item.title !== 'string' ||
      !['string', 'number'].includes(typeof item.price) || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 ||
      (item.sku_id != null && (!Number.isSafeInteger(item.sku_id) || item.sku_id < 1)) ||
      (item.available !== undefined && ![true, false, 0, 1].includes(item.available))) return false;
    const key = cartItemKey(item);
    if (keys.has(key)) return false;
    keys.add(key); return true;
  });
}
