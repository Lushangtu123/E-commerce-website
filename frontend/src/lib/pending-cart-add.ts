import type { CartInput } from '@/lib/api/orders';

export interface PendingCartAdd { key: string; input: CartInput }
const storageKey = (sessionId: string, userId: number) => `pending-cart-add:${sessionId}:${userId}`;
let revision = 0;
const listeners = new Set<() => void>();
export const cartAddRevision = () => revision;
export const subscribeCartAdd = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const notifyCartAddChanged = () => { revision++; listeners.forEach(listener => listener()); };

/** One immutable intent per tab/sign-in/customer. Unreadable storage must block a fresh add. */
export function readPendingCartAdd(sessionId: string, userId: number): PendingCartAdd | null {
  const value = sessionStorage.getItem(storageKey(sessionId, userId));
  if (value === null) return null;
  const attempt = JSON.parse(value) as PendingCartAdd;
  const input = attempt?.input;
  if (!attempt || typeof attempt.key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(attempt.key) ||
    Object.keys(attempt).some(name => !['key', 'input'].includes(name)) ||
    !input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(name => !['product_id', 'sku_id', 'quantity'].includes(name)) ||
    !Number.isSafeInteger(input.product_id) || input.product_id < 1 || input.product_id > 2147483647 ||
    !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 2147483647 ||
    (input.sku_id !== undefined && (!Number.isSafeInteger(input.sku_id) || input.sku_id < 1 || input.sku_id > 2147483647))) throw new Error('Invalid pending cart add');
  return attempt;
}

export function storePendingCartAdd(sessionId: string, userId: number, attempt: PendingCartAdd): boolean {
  try {
    const previous = readPendingCartAdd(sessionId, userId), value = JSON.stringify(attempt);
    if (previous && JSON.stringify(previous) !== value) return false;
    sessionStorage.setItem(storageKey(sessionId, userId), value);
    const saved = sessionStorage.getItem(storageKey(sessionId, userId)) === value;
    notifyCartAddChanged(); return saved;
  } catch { return false; }
}

export function clearPendingCartAdd(sessionId: string, userId: number, key: string): boolean {
  try {
    const previous = readPendingCartAdd(sessionId, userId);
    if (previous && previous.key !== key) return false;
    sessionStorage.removeItem(storageKey(sessionId, userId));
    const cleared = sessionStorage.getItem(storageKey(sessionId, userId)) === null;
    notifyCartAddChanged(); return cleared;
  } catch { return false; }
}
