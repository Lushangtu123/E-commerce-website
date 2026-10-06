'use client';

import { useEffect, useRef, useState } from 'react';
import { ADMIN_SESSION_EVENT, ADMIN_SESSION_KEY, getAdminSessionId } from '@/lib/admin-session';

export function useAdminSession() {
  const [sessionId, setSessionId] = useState(() => getAdminSessionId());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sync = () => setSessionId(getAdminSessionId());
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === ADMIN_SESSION_KEY || event.key === 'admin_user') sync(); };
    sync(); window.addEventListener?.('storage', storage); window.addEventListener?.(ADMIN_SESSION_EVENT, sync);
    return () => { mounted.current = false; window.removeEventListener?.('storage', storage); window.removeEventListener?.(ADMIN_SESSION_EVENT, sync); };
  }, []);
  return { sessionId, active: () => mounted.current && !!sessionId && getAdminSessionId() === sessionId };
}
