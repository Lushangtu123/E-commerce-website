import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';

// Stores are module singletons shared by every test in a file; start each test signed out with an empty cart.
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useCartStore.setState(useCartStore.getInitialState(), true);
  useLocaleStore.setState(useLocaleStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});
