'use client';

import { useEffect, useRef, useState } from 'react';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT, ADMIN_SESSION_KEY, adminSessionIsReady, getAdminSessionId } from '@/lib/admin-session';

export function useAdminSession() {
  const [sessionId, setSessionId] = useState(() => getAdminSessionId());
  const [, notifySessionChange] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sync = () => { setSessionId(getAdminSessionId()); notifySessionChange(value => value + 1); };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === ADMIN_SESSION_KEY || event.key === 'admin_user' || event.key === ADMIN_CLEANUP_KEY) sync(); };
    sync(); window.addEventListener?.('storage', storage); window.addEventListener?.(ADMIN_SESSION_EVENT, sync);
    return () => { mounted.current = false; window.removeEventListener?.('storage', storage); window.removeEventListener?.(ADMIN_SESSION_EVENT, sync); };
  }, []);
  return { sessionId, ready: adminSessionIsReady(), active: () => mounted.current && !!sessionId && adminSessionIsReady() && getAdminSessionId() === sessionId };
}
