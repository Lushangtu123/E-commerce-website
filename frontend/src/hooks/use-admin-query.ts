'use client';

import { useEffect, useState } from 'react';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT, ADMIN_SESSION_KEY, adminSessionIsReady, getAdminSessionId } from '@/lib/admin-session';
import { useScopedQuery } from '@/hooks/use-scoped-query';

/** The stored administrator sessionId, read again whenever this or another tab changes the session. */
export function useAdminSessionId() {
  const [, notifySessionChange] = useState(0);
  useEffect(() => {
    const sync = () => notifySessionChange(value => value + 1);
    const onStorage = (event: StorageEvent) => {
      if ((event.storageArea === null || event.storageArea === localStorage) &&
        (event.key === null || event.key === ADMIN_SESSION_KEY || event.key === 'admin_user' || event.key === ADMIN_CLEANUP_KEY)) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_SESSION_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_SESSION_EVENT, sync);
    };
  }, []);
  return getAdminSessionId();
}

interface AdminQueryOptions<T> {
  /** Names the data; with the sessionId it forms the prefix that `invalidate` refreshes. */
  name: string;
  params: readonly unknown[];
  load: () => Promise<T>;
  enabled?: boolean;
}

/** Loads data for the signed-in administrator; see useScopedQuery. */
export function useAdminQuery<T>({ name, params, load, enabled = true }: AdminQueryOptions<T>) {
  const sessionId = useAdminSessionId();
  const query = useScopedQuery({
    scope: ['admin', name, sessionId],
    params,
    load,
    enabled: enabled && !!sessionId && adminSessionIsReady(),
    sessionIsCurrent: () => !!sessionId && adminSessionIsReady() && getAdminSessionId() === sessionId,
  });
  return { ...query, sessionId };
}
