'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaleSessionError } from '@/lib/query-client';

interface ScopedQueryOptions<T> {
  /** Names the data and the session it belongs to; `invalidate` refreshes every query under it. */
  scope: readonly unknown[];
  params: readonly unknown[];
  load: () => Promise<T>;
  enabled: boolean;
  /** True while the session the scope names is still the signed-in one. */
  sessionIsCurrent: () => boolean;
}

/**
 * Loads data that belongs to one signed-in session. The query key carries the session, so a response
 * only fills the session that asked for it, and nothing is shown once this or another tab changes it.
 */
export function useScopedQuery<T>({ scope, params, load, enabled, sessionIsCurrent }: ScopedQueryOptions<T>) {
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const query = useQuery({
    queryKey: [...scope, ...params],
    enabled,
    // Another session must not find this one's data in memory once the page stops using it.
    gcTime: 0,
    queryFn: async () => {
      if (!sessionIsCurrent()) throw new StaleSessionError();
      const data = await load();
      if (!sessionIsCurrent()) throw new StaleSessionError();
      return data;
    },
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isCurrentSession = () => mounted.current && sessionIsCurrent();
  const live = isCurrentSession();
  return {
    data: live && query.isSuccess ? query.data : undefined,
    // A retry shows the loading state again rather than the error it is replacing. TanStack does this itself
    // for a query without data, but keeps the error of one whose earlier data failed to refresh.
    error: live && query.isError && !query.isFetching && !(query.error instanceof StaleSessionError) ? query.error : undefined,
    isCurrentSession,
    // A refetch for a session that is no longer current fails its first check without a request.
    refetch: async () => { await query.refetch({ cancelRefetch: false }); },
    /** Reloads whatever this session's pages of the data are displayed now. */
    invalidate: () => queryClient.invalidateQueries({ queryKey: scope }),
  };
}
