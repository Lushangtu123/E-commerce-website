import { useSyncExternalStore } from 'react';
import { cartAddRevision, readPendingCartAdd, subscribeCartAdd } from '@/lib/pending-cart-add';
import { isCartAddActive } from '@/lib/cart-add';
import { storedSessionId, useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

/** Read at action time too: a handler from an earlier render must respect the pending intent. */
export function cartAddBlocksWrites(sessionId: string, userId: number): boolean {
  try { return useCartStore.getState().pendingWrites > 0 || isCartAddActive(sessionId, userId) || readPendingCartAdd(sessionId, userId) !== null; }
  catch { return true; }
}

export function useCartAddRecovery() {
  useSyncExternalStore(subscribeCartAdd, cartAddRevision, () => 0);
  const auth = useAuthStore();
  const pendingWrites = useCartStore(state => state.pendingWrites);
  if (!auth.isHydrated || !auth.isAuthenticated || !auth.sessionId || !auth.user) return { pending: null, busy: false, blocked: false };
  try {
    if (storedSessionId() !== auth.sessionId) return { pending: null, busy: false, blocked: false };
    const pending = readPendingCartAdd(auth.sessionId, auth.user.user_id);
    return { pending, busy: pendingWrites > 0 || isCartAddActive(auth.sessionId, auth.user.user_id), blocked: false };
  } catch { return { pending: null, busy: false, blocked: true }; }
}
