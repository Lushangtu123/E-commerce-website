'use client';

import { useEffect, useRef } from 'react';
import { useSessionQuery } from '@/hooks/use-session-query';
import { useCartAddRecovery } from '@/hooks/use-cart-add-recovery';
import { readCanonicalCart } from '@/lib/cart-sync';
import { useCartStore } from '@/store/useCartStore';

/** The page and badge share canonical reads; session query supplies the existing cache/identity boundary. */
export function useCartBadge() {
  const { revision, syncStatus, pendingWrites, getTotalCount } = useCartStore();
  const add = useCartAddRecovery();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const state = useCartStore.getState();
      // Returning from an admin page must restart an abandoned global read.
      if (state.syncStatus === 'loading' && state.pendingWrites === 0) {
        useCartStore.setState({ revision: state.revision + 1, syncStatus: 'idle' });
      }
    };
  }, []);
  const blocked = !!add.pending || add.busy || add.blocked || pendingWrites > 0;
  const query = useSessionQuery({ name: 'cart-badge', params: [revision], load: () => readCanonicalCart(() => mounted.current),
    enabled: syncStatus === 'idle' && !blocked });
  return {
    status: blocked || syncStatus === 'idle' ? 'loading' : syncStatus,
    count: getTotalCount(),
    current: query.isCurrentSession(),
    retry: () => { if (!blocked && query.isCurrentSession()) void query.refetch(); },
  };
}
