import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { useCartStore } from '@/store/useCartStore';
import { newSessionId } from '@/lib/session-id';

export interface User {
  user_id: number;
  username: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
}

interface AuthState {
  user: User | null;
  /** Names this sign-in so tabs and requests can tell sessions apart. It is not a credential. */
  sessionId: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (user: User, sessionId?: string) => string;
  logout: () => void;
  updateUser: (user: Partial<User>, expectedSessionId?: string) => boolean;
  hydrate: () => void;
}

/**
 * The browser keeps the session itself in an httpOnly cookie the page cannot read. Storage only
 * holds this sign-in's id and profile, so every tab can see when another one signs in or out.
 */
export const SESSION_KEY = 'session';
export const CUSTOMER_CLEANUP_KEY = 'customer_session_cleanup_pending';
/** Where signed tokens used to be stored; such a session has no cookie and must sign in again. */
const LEGACY_TOKEN_KEY = 'token';

export class CustomerSessionPublicationError extends Error {
  constructor(public readonly sessionReplaced: boolean, public readonly storageInvalidated: boolean) {
    super('Unable to record customer sign-in');
  }
}

export function storedSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

// 从localStorage加载状态
const loadFromStorage = () => {
  if (typeof window === 'undefined') return { user: null, sessionId: null, isAuthenticated: false };

  try {
    // A reload must not restore a profile from an unfinished cookie write or failed publication.
    if (localStorage.getItem(CUSTOMER_CLEANUP_KEY) === '1') return { user: null, sessionId: null, isAuthenticated: false };
    if (localStorage.getItem(LEGACY_TOKEN_KEY) !== null) {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      if (storedSessionId() === null) localStorage.removeItem('user');
    }
    const sessionId = storedSessionId();
    const userStr = localStorage.getItem('user');

    if (sessionId && userStr) {
      const user = JSON.parse(userStr);
      return { user, sessionId, isAuthenticated: true };
    }
  } catch (error) {
    logger.error('Failed to load auth state:', error);
  }

  return { user: null, sessionId: null, isAuthenticated: false };
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  sessionId: null,
  isAuthenticated: false,
  isHydrated: false,
  
  // 手动水合
  hydrate: () => {
    const state = loadFromStorage();
    const previous = get();
    if (previous.sessionId !== state.sessionId || previous.user?.user_id !== state.user?.user_id) {
      useCartStore.getState().clearCart();
    }
    set({ ...state, isHydrated: true });
  },
  
  // The server has already set the session cookie; this records which sign-in it was.
  login: (user, sessionId = newSessionId()) => {
    const previous = get();
    let previousStoredId: string | null = null;
    let wroteSessionId = false;
    try {
      previousStoredId = storedSessionId();
      localStorage.setItem(SESSION_KEY, sessionId);
      wroteSessionId = true;
      localStorage.setItem('user', JSON.stringify(user));
      useCartStore.getState().clearCart();
      set({ user, sessionId, isAuthenticated: true, isHydrated: true });
      // Confirm publication inside the cookie writer, including changes from synchronous subscribers.
      if (storedSessionId() !== sessionId || JSON.parse(localStorage.getItem('user') || 'null')?.user_id !== user.user_id ||
          get().sessionId !== sessionId || get().user?.user_id !== user.user_id) throw new Error('Customer session publication changed');
      return sessionId;
    } catch {
      let sessionReplaced = false;
      let storageInvalidated = false;
      try {
        const current = storedSessionId();
        sessionReplaced = current !== sessionId && (wroteSessionId || current !== previousStoredId);
        if (!sessionReplaced) {
          // The old cookie has already been replaced too: revoke either id still owned by this attempt.
          try { localStorage.removeItem(SESSION_KEY); } catch { /* The profile removal can still invalidate the pair. */ }
          const after = storedSessionId();
          if (after === null || after === current) {
            try { localStorage.removeItem('user'); } catch { /* Cookie cleanup remains required. */ }
          } else sessionReplaced = true;
          storageInvalidated = storedSessionId() === null || localStorage.getItem('user') === null;
        }
      } catch { /* Unavailable storage cannot prove ownership of a replacement. */ }
      const current = get();
      if (!sessionReplaced && ((current.sessionId === previous.sessionId && current.user?.user_id === previous.user?.user_id) ||
          (current.sessionId === sessionId && current.user?.user_id === user.user_id))) {
        useCartStore.getState().clearCart();
        set({ user: null, sessionId: null, isAuthenticated: false, isHydrated: true });
      }
      throw new CustomerSessionPublicationError(sessionReplaced, storageInvalidated);
    }
  },

  // Forgets this tab's sign-in; signOut also asks the server to clear the session cookie.
  logout: () => {
    // Local storage failure must never prevent signOut from reaching the cookie-clearing API.
    try { localStorage.removeItem(SESSION_KEY); } catch { /* Continue with the other key and in-memory state. */ }
    try { localStorage.removeItem('user'); } catch { /* The server cookie is cleared separately. */ }
    useCartStore.getState().clearCart();
    set({ user: null, sessionId: null, isAuthenticated: false, isHydrated: true });
  },
  
  updateUser: (userData, expectedSessionId) => {
    const state = get();
    if (!state.isHydrated || !state.isAuthenticated || !state.user || !state.sessionId ||
      (expectedSessionId !== undefined && expectedSessionId !== state.sessionId) ||
      (userData.user_id !== undefined && userData.user_id !== state.user.user_id)) return false;
    try {
      if (storedSessionId() !== state.sessionId ||
        JSON.parse(localStorage.getItem('user') || 'null')?.user_id !== state.user.user_id) return false;
      const user: User = { user_id: state.user.user_id, username: state.user.username, email: state.user.email,
        phone: state.user.phone, avatar_url: state.user.avatar_url };
      for (const key of ['username', 'email'] as const) {
        if (Object.hasOwn(userData, key)) {
          if (typeof userData[key] !== 'string') return false;
          user[key] = userData[key]!;
        }
      }
      for (const key of ['phone', 'avatar_url'] as const) {
        if (Object.hasOwn(userData, key)) {
          if (userData[key] != null && typeof userData[key] !== 'string') return false;
          user[key] = userData[key];
        }
      }
      // Persist before publishing state, so a refresh cannot restore obsolete details.
      localStorage.setItem('user', JSON.stringify(user));
      set({ user });
      return true;
    } catch (error) {
      logger.error('Failed to save profile state:', error);
      return false;
    }
  },
}));
