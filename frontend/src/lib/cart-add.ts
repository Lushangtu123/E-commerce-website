import { cartApi, type CartInput } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';
import { beginCartWrite, readCanonicalCart } from '@/lib/cart-sync';
import { clearPendingCartAdd, notifyCartAddChanged, readPendingCartAdd, storePendingCartAdd, type PendingCartAdd } from '@/lib/pending-cart-add';
import { storedSessionId, useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

const activeAdds = new Set<string>();
const canonicalReadListeners = new Set<(sessionId: string, userId: number) => void>();
export const subscribeCanonicalCartAdd = (listener: (sessionId: string, userId: number) => void) => {
  canonicalReadListeners.add(listener);
  return () => { canonicalReadListeners.delete(listener); };
};
const scopeKey = (sessionId: string, userId: number) => JSON.stringify([sessionId, userId]);
export const isCartAddActive = (sessionId: string, userId: number) => activeAdds.has(scopeKey(sessionId, userId));
const storageError = () => new Error('无法保存购物车添加请求，请恢复浏览器存储后重试');

/** Every entry point shares this account guard and durable retry identity. Retries only follow a user action. */
async function runCartAdd(input: CartInput | null, isActive: () => boolean): Promise<boolean> {
  const session = useAuthStore.getState();
  if (!session.isHydrated || !session.isAuthenticated || !session.sessionId || !session.user) throw new Error('请先登录');
  const sessionId = session.sessionId, userId = session.user.user_id, scope = scopeKey(sessionId, userId);
  const current = () => {
    const state = useAuthStore.getState();
    try {
      return isActive() && state.isHydrated && state.isAuthenticated && state.sessionId === sessionId &&
        state.user?.user_id === userId && storedSessionId() === sessionId;
    } catch { return false; }
  };
  if (!current()) return false;
  if (useCartStore.getState().pendingWrites > 0) throw new Error('购物车正在更新，请稍候');
  if (activeAdds.has(scope)) throw new Error('购物车添加正在处理中，请稍候');
  let attempt: PendingCartAdd | null;
  try { attempt = readPendingCartAdd(sessionId, userId); } catch { throw storageError(); }
  if (input && attempt) throw new Error('请先重试未确认的购物车添加');
  if (input) {
    const normalized = { product_id: input.product_id, quantity: input.quantity, ...(input.sku_id == null ? {} : { sku_id: input.sku_id }) };
    try { attempt = { key: crypto.randomUUID(), input: normalized }; } catch { throw storageError(); }
  }
  if (!attempt) return false;
  // Persist before dispatch, including on retry. A refresh can interrupt after the server commits.
  if (!storePendingCartAdd(sessionId, userId, attempt)) throw storageError();
  activeAdds.add(scope); notifyCartAddChanged();
  const finishWrite = beginCartWrite();
  let acknowledged = false;
  try {
    if (!current()) return false;
    const result = await cartApi.add({ ...attempt.input, add_key: attempt.key });
    if (!current()) return false;
    if (!result || result.add_key !== attempt.key || typeof result.replayed !== 'boolean') throw new Error('Invalid cart add receipt');
    acknowledged = true;
    const data = await readCanonicalCart(current, { fresh: true });
    if (!current()) return false;
    if (!data.accepted) throw new Error('Canonical cart superseded');
    canonicalReadListeners.forEach(listener => listener(sessionId, userId));
    if (!clearPendingCartAdd(sessionId, userId, attempt.key)) throw storageError();
    return true;
  } catch (error) {
    if (!current()) return false;
    const status = requestFailure(error).response?.status;
    // Only a first attempt's definitive rejection permits a new intent. A prior uncertain attempt
    // keeps its receipt on retry failures, including 409, because its original commit may exist.
    if (input && !acknowledged && status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
      if (!clearPendingCartAdd(sessionId, userId, attempt.key)) throw storageError();
      finishWrite(true);
      throw error;
    }
    throw new Error('购物车添加结果尚未确认，请重试原请求');
  } finally { finishWrite(); activeAdds.delete(scope); notifyCartAddChanged(); }
}

export const addToCart = (input: CartInput, isActive: () => boolean = () => true) => runCartAdd(input, isActive);
export const retryCartAdd = (isActive: () => boolean = () => true) => runCartAdd(null, isActive);
