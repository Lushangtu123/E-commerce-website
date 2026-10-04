export const ADMIN_SESSION_EVENT = 'admin-session-changed';

export interface AdminSession {
  token: string;
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
    const token = localStorage.getItem('admin_token');
    const stored = localStorage.getItem('admin_user');
    if (!token || token.trim() !== token || !token.trim() || token === 'undefined' || token === 'null' || !stored) return null;
    const admin = JSON.parse(stored);
    if (!admin || typeof admin !== 'object' || Array.isArray(admin) || typeof admin.username !== 'string' || !admin.username.trim()) return null;
    if (admin.admin_id !== undefined && (!Number.isSafeInteger(admin.admin_id) || admin.admin_id <= 0)) return null;
    for (const field of ['real_name', 'role_name']) {
      if (admin[field] !== undefined && admin[field] !== null && typeof admin[field] !== 'string') return null;
    }
    return { token, admin };
  } catch {
    return null;
  }
}

export function getAdminSessionToken(): string | null {
  return getAdminSession()?.token ?? null;
}

// Only clear the session that initiated an action; an old response must not
// remove credentials written by a later login. Customer/locale keys are separate.
export function clearAdminSession(expectedToken: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem('admin_token') !== expectedToken) return false;
    localStorage.removeItem('admin_token');
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
