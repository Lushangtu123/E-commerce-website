import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/** Next navigation updates useSearchParams and browser history together. */
export interface CatalogQuery {
  current: URLSearchParams;
  listeners: Set<() => void>;
}
export function useCatalogSearchParams(query: CatalogQuery) {
  return useSyncExternalStore(listener => {
    query.listeners.add(listener);
    return () => { query.listeners.delete(listener); };
  }, () => query.current, () => query.current);
}
export function installCatalogRouter(router: { push: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> }, query: CatalogQuery) {
  const navigate = (href: string, replace: boolean) => {
    const url = new URL(href, 'http://localhost');
    window.history[replace ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}`);
    query.current = new URLSearchParams(url.search);
    query.listeners.forEach(listener => listener());
  };
  router.push.mockImplementation((href: string) => navigate(href, false));
  router.replace.mockImplementation((href: string) => navigate(href, true));
}
