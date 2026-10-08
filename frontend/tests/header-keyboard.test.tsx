import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
describe('search dropdown keyboard controls', () => {
  it.each(['zh-CN', 'en'] as const)('searches history and hot keywords, deletes independently (%s)', async locale => {
    useLocaleStore.setState({ locale });
    useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.invalid' }, 'keyboard-session');
    let removed = false;
    const mutations: string[] = [], original = api.defaults.adapter;
    api.defaults.adapter = async config => {
      if (config.method === 'delete') { removed = true; mutations.push(config.url!); }
      return { config, status: 200, statusText: 'OK', headers: {}, data:
        config.url === '/search/hot' ? { keywords: [{ keyword: 'Hot keyboard', search_count: 3 }] }
          : config.url === '/search/history' ? { history: removed ? [] : [{ keyword: 'History keyboard' }] } : {} };
    };
    try {
      render(<Header />); await settle();
      const input = screen.getByRole('textbox', { name: locale === 'en' ? 'Search products' : '搜索商品' });
      act(() => { input.focus(); }); await userEvent.tab(); await userEvent.tab();
      const history = screen.getByRole('button', { name: 'History keyboard' });
      expect(history).toHaveFocus(); await userEvent.keyboard('{Enter}');
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/products?keyword=History%20keyboard');
      router.push.mockClear();
      act(() => { input.focus(); });
      const hot = screen.getByRole('button', { name: /Hot keyboard/ }); hot.focus(); await userEvent.keyboard(' ');
      expect(router.push).toHaveBeenCalledExactlyOnceWith('/products?keyword=Hot%20keyboard');
      router.push.mockClear();
      act(() => { input.focus(); });
      const remove = screen.getByRole('button', { name: locale === 'en' ? 'Delete search history: History keyboard' : '删除搜索历史：History keyboard' });
      remove.focus(); await userEvent.keyboard('{Enter}'); await settle();
      expect(mutations).toEqual(['/search/history/History%20keyboard']); expect(router.push).not.toHaveBeenCalled();
      expect(input).toHaveValue('Hot keyboard'); expect(screen.queryByText('History keyboard')).not.toBeInTheDocument();
    } finally { api.defaults.adapter = original; }
  });
});
