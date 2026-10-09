import { useSyncExternalStore } from 'react';
import { cartAddRevision, readPendingCartAdd, subscribeCartAdd } from '@/lib/pending-cart-add';
import { isCartAddActive } from '@/lib/cart-add';
import { storedSessionId, useAuthStore } from '@/store/useAuthStore';

/** Read at action time too: a handler from an earlier render must respect the pending intent. */
export function cartAddBlocksWrites(sessionId: string, userId: number): boolean {
  try { return isCartAddActive(sessionId, userId) || readPendingCartAdd(sessionId, userId) !== null; }
  catch { return true; }
}

export function useCartAddRecovery() {
  useSyncExternalStore(subscribeCartAdd, cartAddRevision, () => 0);
  const auth = useAuthStore();
  if (!auth.isHydrated || !auth.isAuthenticated || !auth.sessionId || !auth.user) return { pending: null, busy: false, blocked: false };
  try {
    if (storedSessionId() !== auth.sessionId) return { pending: null, busy: false, blocked: false };
    const pending = readPendingCartAdd(auth.sessionId, auth.user.user_id);
    return { pending, busy: isCartAddActive(auth.sessionId, auth.user.user_id), blocked: false };
  } catch { return { pending: null, busy: false, blocked: true }; }
}
