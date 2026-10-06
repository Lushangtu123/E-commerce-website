'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/useAuthStore';
import { StaleSessionError } from '@/lib/query-client';

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

/**
 * Loads data for the signed-in customer. The query key carries the session, so a response only fills
 * the account that asked for it, and nothing is shown once this or another tab changes the session.
 */
export function useSessionQuery<T>({ name, params, load, enabled = true }: SessionQueryOptions<T>) {
  const queryClient = useQueryClient();
  const { token, user, isHydrated, isAuthenticated } = useAuthStore();
  const userId = user?.user_id;
  const mounted = useRef(true);
  const query = useQuery({
    queryKey: [name, token, userId, ...params],
    enabled: enabled && isHydrated && isAuthenticated && !!user,
    // Another account must not find this one's data in memory once the page stops using it.
    gcTime: 0,
    queryFn: async () => {
      if (!sessionIsCurrent(token, userId)) throw new StaleSessionError();
      const data = await load();
      if (!sessionIsCurrent(token, userId)) throw new StaleSessionError();
      return data;
    },
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isCurrentSession = () => mounted.current && sessionIsCurrent(token, userId);
  const live = isCurrentSession();
  return {
    data: live && query.isSuccess ? query.data : undefined,
    // A retry shows the loading state again rather than the error it is replacing. TanStack does this itself
    // for a query without data, but keeps the error of one whose earlier data failed to refresh.
    error: live && query.isError && !query.isFetching && !(query.error instanceof StaleSessionError) ? query.error : undefined,
    isCurrentSession,
    // A refetch for a session that is no longer current fails its first check without a request.
    refetch: async () => { await query.refetch(); },
    /** Reloads whatever this session's pages of the data are displayed now. */
    invalidate: () => queryClient.invalidateQueries({ queryKey: [name, token, userId] }),
  };
}
