import { newSessionId } from '@/lib/session-id';

export const ADMIN_SESSION_EVENT = 'admin-session-changed';
/**
 * The administrator session itself is the httpOnly admin_session cookie the page cannot read.
 * Storage only names this sign-in, so every tab can tell when another one signs in or out.
 */
export const ADMIN_SESSION_KEY = 'admin_session';
/** Where signed tokens used to be stored; such a session has no cookie and must sign in again. */
const LEGACY_TOKEN_KEY = 'admin_token';

export interface AdminSession {
  sessionId: string;
  admin: {
    admin_id?: number;
    username: string;
    real_name?: string | null;
    role_name?: string | null;
  };
}

// Older valid sessions contain only username/role_name. Validate fields used by
// the layout without requiring newer response fields or trusting stored roles.
export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(LEGACY_TOKEN_KEY) !== null) {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      if (localStorage.getItem(ADMIN_SESSION_KEY) === null) localStorage.removeItem('admin_user');
    }
    const sessionId = localStorage.getItem(ADMIN_SESSION_KEY);
    const stored = localStorage.getItem('admin_user');
    if (!sessionId || sessionId.trim() !== sessionId || !sessionId.trim() || sessionId === 'undefined' || sessionId === 'null' || !stored) return null;
    const admin = JSON.parse(stored);
    if (!admin || typeof admin !== 'object' || Array.isArray(admin) || typeof admin.username !== 'string' || !admin.username.trim()) return null;
    if (admin.admin_id !== undefined && (!Number.isSafeInteger(admin.admin_id) || admin.admin_id <= 0)) return null;
    for (const field of ['real_name', 'role_name']) {
      if (admin[field] !== undefined && admin[field] !== null && typeof admin[field] !== 'string') return null;
    }
    return { sessionId, admin };
  } catch {
    return null;
  }
}

export function getAdminSessionId(): string | null {
  return getAdminSession()?.sessionId ?? null;
}

/** Records a sign-in whose session cookie the API has just set. */
export function startAdminSession(admin: AdminSession['admin']): void {
  localStorage.setItem(ADMIN_SESSION_KEY, newSessionId());
  localStorage.setItem('admin_user', JSON.stringify(admin));
}

// Only clear the session that initiated an action; an old response must not
// remove credentials written by a later login. Customer/locale keys are separate.
export function clearAdminSession(expectedSessionId: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(ADMIN_SESSION_KEY) !== expectedSessionId) return false;
    localStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem('admin_user');
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(ADMIN_SESSION_EVENT));
  } catch {
    // Storage cleanup also works in environments without DOM events.
  }
  return true;
}
