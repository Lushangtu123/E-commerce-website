import { act, render } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '@/components/HomePage';
import { productApi, recommendationApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';

vi.mock('@/lib/api', () => ({
  productApi: { getHotProducts: vi.fn(), list: vi.fn() },
  recommendationApi: { getGuessYouLike: vi.fn() },
}));
vi.mock('@/components/ProductCard', () => ({
  default: () => null,
  ProductCardSkeleton: () => <div>Loading product</div>,
}));

describe('home session hydration', () => {
  it('waits for session restoration before fetching recommendations', async () => {
    vi.mocked(productApi.getHotProducts).mockResolvedValue({ products: [] });
    vi.mocked(productApi.list).mockResolvedValue({ products: [], total: 0, page: 1, limit: 8, totalPages: 0 });
    vi.mocked(recommendationApi.getGuessYouLike).mockResolvedValue({ recommendations: [] });
    const view = render(<HomePage />);
    expect(recommendationApi.getGuessYouLike).not.toHaveBeenCalled();
    expect(view.queryByText('猜你喜欢')).toBeNull();
    await act(() => useAuthStore.getState().hydrate());
    expect(recommendationApi.getGuessYouLike).toHaveBeenCalledTimes(1);
  });

  it.each(['anonymous', 'restored account'] as const)('hydrates server markup without browser storage for %s', async session => {
    vi.mocked(productApi.getHotProducts).mockResolvedValue({ products: [] });
    vi.mocked(productApi.list).mockResolvedValue({ products: [], total: 0, page: 1, limit: 8, totalPages: 0 });
    vi.mocked(recommendationApi.getGuessYouLike).mockResolvedValue({ recommendations: [] });
    const storage = localStorage;
    const container = document.createElement('div');
    try {
      vi.stubGlobal('localStorage', undefined);
      container.innerHTML = renderToString(<HomePage />);
    } finally { vi.stubGlobal('localStorage', storage); }

    // AppShell can restore a session before this streamed boundary hydrates.
    if (session === 'restored account') {
      useAuthStore.getState().login({ user_id: 1, username: 'Customer', email: 'customer@example.test' }, 'restored-session');
    } else useAuthStore.getState().hydrate();

    const failures: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, <HomePage />, { onRecoverableError: error => failures.push(error) });
      });
      expect(failures).toEqual([]);
      expect(recommendationApi.getGuessYouLike).toHaveBeenCalled();
      expect(container.textContent).toContain('暂无商品');
    } finally { if (root) await act(() => root.unmount()); }
  });
});
