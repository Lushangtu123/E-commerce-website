import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { useCartStore } from '@/store/useCartStore';

interface User {
  user_id: number;
  username: string;
  email: string;
  phone?: string;
  avatar_url?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isHydrated: false,
  
  // 手动水合
  hydrate: () => {
    const state = loadFromStorage();
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
  
  updateUser: (userData) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...userData } : null,
    })),
}));
