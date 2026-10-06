'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { useScopedQuery } from '@/hooks/use-scoped-query';

/** True while the store and browser storage still hold the session a request was made for. */
export function sessionIsCurrent(token: string | null, userId: number | undefined) {
  const state = useAuthStore.getState();
  return state.isHydrated && state.isAuthenticated && state.token === token && state.user?.user_id === userId &&
    localStorage.getItem('token') === (token ?? null);
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
  const { token, user, isHydrated, isAuthenticated } = useAuthStore();
  const userId = user?.user_id;
  return useScopedQuery({
    scope: [name, token, userId],
    params,
    load,
    enabled: enabled && isHydrated && isAuthenticated && !!user,
    sessionIsCurrent: () => sessionIsCurrent(token, userId),
  });
}
