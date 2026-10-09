import { cartApi } from '@/lib/api';
import { validCartItems } from '@/lib/cart-contents';
import { sessionIsCurrent } from '@/hooks/use-session-query';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';

interface CartRead { items: CartItem[]; accepted: boolean }
const reads = new Map<string, { promise: Promise<CartRead>; consumers: Set<() => boolean> }>();
const listeners = new Set<(sessionId: string, userId: number, items: CartItem[]) => void>();
export const subscribeCanonicalCart = (listener: (sessionId: string, userId: number, items: CartItem[]) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const current = (sessionId: string | null, userId: number | undefined) => {
  try { return !!sessionId && !!userId && sessionIsCurrent(sessionId, userId); }
  catch { return false; }
};

/** Share an in-flight canonical read; a newer write or customer can never inherit its result. */
export function readCanonicalCart(isActive: () => boolean = () => true, options: { fresh?: boolean } = {}): Promise<CartRead> {
  const { sessionId, user } = useAuthStore.getState();
  const userId = user?.user_id;
  if (!isActive() || !current(sessionId, userId)) return Promise.resolve({ items: [], accepted: false });
  // A post-write read cannot share a request dispatched before that write was acknowledged.
  if (options.fresh) useCartStore.setState(state => ({ revision: state.revision + 1 }));
  const { revision, items: previousItems } = useCartStore.getState();
  const key = JSON.stringify([sessionId, userId, revision]);
  const existing = reads.get(key);
  if (existing && Array.from(existing.consumers).some(active => active())) {
    existing.consumers.add(isActive); return existing.promise;
  }
  const consumers = new Set([isActive]);
  const canPublish = () => current(sessionId, userId) && useCartStore.getState().revision === revision &&
    useCartStore.getState().items === previousItems && Array.from(consumers).some(active => active());
  useCartStore.setState({ syncStatus: 'loading' });
  let response: ReturnType<typeof cartApi.list>;
  try { response = cartApi.list(); } catch (error) { response = Promise.reject(error); }
  const read: Promise<CartRead> = (async () => {
    try {
      const data = await response;
      if (!canPublish()) return { items: [], accepted: false };
      if (!validCartItems(data?.items)) throw new Error('Invalid canonical cart');
      useCartStore.getState().setItems(data.items);
      listeners.forEach(listener => listener(sessionId!, userId!, data.items));
      return { items: data.items, accepted: true };
    } catch (error) {
      if (canPublish()) useCartStore.setState({ syncStatus: 'error' });
      throw error;
    } finally { if (reads.get(key)?.consumers === consumers) reads.delete(key); }
  })();
  reads.set(key, { promise: read, consumers });
  return read;
}

/** Invalidate reads at dispatch, rather than waiting until a write's response changes the items. */
export function beginCartWrite() {
  const { sessionId, user } = useAuthStore.getState();
  const userId = user?.user_id;
  const before = useCartStore.getState();
  const revision = before.revision + 1;
  useCartStore.setState({ revision, syncStatus: 'loading', pendingWrites: before.pendingWrites + 1 });
  let finished = false;
  return (unchanged = false) => {
    if (finished) return;
    finished = true;
    if (!current(sessionId, userId)) return;
    const state = useCartStore.getState();
    const pendingWrites = Math.max(0, state.pendingWrites - 1);
    const pendingRead = reads.get(JSON.stringify([sessionId, userId, state.revision]));
    const reading = pendingRead && Array.from(pendingRead.consumers).some(active => active());
    const syncStatus = state.syncStatus !== 'loading' || pendingWrites > 0 || reading ? state.syncStatus
      : unchanged && state.revision === revision ? before.syncStatus === 'ready' ? 'ready' : 'idle' : 'error';
    useCartStore.setState({ pendingWrites, syncStatus });
  };
}
