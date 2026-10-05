'use client';

import { useEffect, useRef, useState } from 'react';
import { ADMIN_SESSION_EVENT, getAdminSessionToken } from '@/lib/admin-session';

export function useAdminSession() {
  const [token, setToken] = useState(() => getAdminSessionToken());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sync = () => setToken(getAdminSessionToken());
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === 'admin_token' || event.key === 'admin_user') sync(); };
    sync(); window.addEventListener?.('storage', storage); window.addEventListener?.(ADMIN_SESSION_EVENT, sync);
    return () => { mounted.current = false; window.removeEventListener?.('storage', storage); window.removeEventListener?.(ADMIN_SESSION_EVENT, sync); };
  }, []);
  return { token, active: () => mounted.current && !!token && getAdminSessionToken() === token };
}
