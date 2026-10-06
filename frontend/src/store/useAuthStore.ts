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
  login: (user: User, sessionId?: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>, expectedSessionId?: string) => boolean;
  hydrate: () => void;
}

/**
 * The browser keeps the session itself in an httpOnly cookie the page cannot read. Storage only
 * holds this sign-in's id and profile, so every tab can see when another one signs in or out.
 */
export const SESSION_KEY = 'session';
/** Where signed tokens used to be stored; such a session has no cookie and must sign in again. */
const LEGACY_TOKEN_KEY = 'token';

export function storedSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

// 从localStorage加载状态
const loadFromStorage = () => {
  if (typeof window === 'undefined') return { user: null, sessionId: null, isAuthenticated: false };

  try {
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
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.setItem('user', JSON.stringify(user));
    useCartStore.getState().clearCart();
    set({ user, sessionId, isAuthenticated: true, isHydrated: true });
  },

  // Forgets this tab's sign-in; signOut also asks the server to clear the session cookie.
  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('user');
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
