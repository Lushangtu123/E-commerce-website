import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';

// Pages ask through confirmAction(); outside AppShell no dialog is mounted, so tests answer through
// window.confirm (stub it with vi.stubGlobal). tests/confirm-dialog.test.tsx covers the real dialog.
vi.mock('@/lib/confirm', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/confirm')>(),
  confirmAction: async (message: string) => window.confirm(message),
}));

// Stores are module singletons shared by every test in a file; start each test signed out with an empty cart.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useCartStore.setState(useCartStore.getInitialState(), true);
  useLocaleStore.setState(useLocaleStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});
