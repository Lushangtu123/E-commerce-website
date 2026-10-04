import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { useCartStore } from '@/store/useCartStore';

export interface User {
  user_id: number;
  username: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>, expectedToken?: string) => boolean;
  hydrate: () => void;
}

// 从localStorage加载状态
const loadFromStorage = () => {
  if (typeof window === 'undefined') return { user: null, token: null, isAuthenticated: false };
  
  try {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (token && userStr) {
      const user = JSON.parse(userStr);
      return { user, token, isAuthenticated: true };
    }
  } catch (error) {
    logger.error('Failed to load auth state:', error);
  }
  
  return { user: null, token: null, isAuthenticated: false };
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isHydrated: false,
  
  // 手动水合
  hydrate: () => {
    const state = loadFromStorage();
    const previous = get();
    if (previous.token !== state.token || previous.user?.user_id !== state.user?.user_id) {
      useCartStore.getState().clearCart();
    }
    set({ ...state, isHydrated: true });
  },
  
  login: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    useCartStore.getState().clearCart();
    set({ user, token, isAuthenticated: true, isHydrated: true });
  },
  
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    useCartStore.getState().clearCart();
    set({ user: null, token: null, isAuthenticated: false, isHydrated: true });
  },
  
  updateUser: (userData, expectedToken) => {
    const state = get();
    if (!state.isHydrated || !state.isAuthenticated || !state.user || !state.token ||
      (expectedToken !== undefined && expectedToken !== state.token) ||
      (userData.user_id !== undefined && userData.user_id !== state.user.user_id)) return false;
    try {
      if (localStorage.getItem('token') !== state.token ||
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
