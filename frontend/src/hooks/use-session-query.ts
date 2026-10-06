'use client';

import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useScopedQuery } from '@/hooks/use-scoped-query';

/** True while the store and browser storage still hold the session a request was made for. */
export function sessionIsCurrent(sessionId: string | null, userId: number | undefined) {
  const state = useAuthStore.getState();
  return state.isHydrated && state.isAuthenticated && state.sessionId === sessionId && state.user?.user_id === userId &&
    storedSessionId() === (sessionId ?? null);
}

interface SessionQueryOptions<T> {
  /** Names the data; with the session it forms the prefix that `invalidate` refreshes. */
  name: string;
  params: readonly unknown[];
  load: () => Promise<T>;
  enabled?: boolean;
}

/** Loads data for the signed-in customer; see useScopedQuery. */
export function useSessionQuery<T>({ name, params, load, enabled = true }: SessionQueryOptions<T>) {
  const { sessionId, user, isHydrated, isAuthenticated } = useAuthStore();
  const userId = user?.user_id;
  return useScopedQuery({
    scope: [name, sessionId, userId],
    params,
    load,
    enabled: enabled && isHydrated && isAuthenticated && !!user,
    sessionIsCurrent: () => sessionIsCurrent(sessionId, userId),
  });
}
