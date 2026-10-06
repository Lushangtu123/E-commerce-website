'use client';

import { useEffect, useState } from 'react';
import { ADMIN_SESSION_EVENT, getAdminSessionToken } from '@/lib/admin-session';
import { useScopedQuery } from '@/hooks/use-scoped-query';

/** The stored administrator token, read again whenever this or another tab changes the session. */
export function useAdminSessionToken() {
  const [, notifySessionChange] = useState(0);
  useEffect(() => {
    const sync = () => notifySessionChange(value => value + 1);
    const onStorage = (event: StorageEvent) => {
      if ((event.storageArea === null || event.storageArea === localStorage) &&
        (event.key === null || event.key === 'admin_token' || event.key === 'admin_user')) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_SESSION_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_SESSION_EVENT, sync);
    };
  }, []);
  return getAdminSessionToken();
}

interface AdminQueryOptions<T> {
  /** Names the data; with the token it forms the prefix that `invalidate` refreshes. */
  name: string;
  params: readonly unknown[];
  load: () => Promise<T>;
  enabled?: boolean;
}

/** Loads data for the signed-in administrator; see useScopedQuery. */
export function useAdminQuery<T>({ name, params, load, enabled = true }: AdminQueryOptions<T>) {
  const token = useAdminSessionToken();
  const query = useScopedQuery({
    scope: ['admin', name, token],
    params,
    load,
    enabled: enabled && !!token,
    sessionIsCurrent: () => !!token && getAdminSessionToken() === token,
  });
  return { ...query, token };
}
