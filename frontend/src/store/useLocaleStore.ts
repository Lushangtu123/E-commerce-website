'use client';

import { create } from 'zustand';

export type Locale = 'zh-CN' | 'en';
export const LOCALE_STORAGE_KEY = 'ecommerce-locale';

interface LocaleState {
  locale: Locale;
  hydrate: () => void;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  // Keep the first client render identical to the server render.
  locale: 'zh-CN',
  hydrate: () => {
    let locale: Locale = 'zh-CN';
    try {
      if (typeof window !== 'undefined' && localStorage.getItem(LOCALE_STORAGE_KEY) === 'en') locale = 'en';
    } catch { /* Storage can be unavailable in private browsing. */ }
    set({ locale });
  },
  setLocale: (locale) => {
    if (locale !== 'zh-CN' && locale !== 'en') return;
    set({ locale });
    try {
      if (typeof window !== 'undefined') localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch { /* Switching still works for the current page. */ }
  },
}));
