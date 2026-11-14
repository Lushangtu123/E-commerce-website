import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

describe('mobile site menu', () => {
  const original = api.defaults.adapter;
  beforeEach(() => {
    api.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
      data: config.url === '/search/hot' ? { keywords: [] } : config.url === '/search/history' ? { history: [] } : {} });
  });
  afterEach(() => { api.defaults.adapter = original; });

  it('opens with the guest links and closes on Escape, returning focus to its button', async () => {
    useLocaleStore.setState({ locale: 'zh-CN' });
    render(<Header />); await settle();
    const button = screen.getByRole('button', { name: '打开菜单' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: '网站菜单' })).not.toBeInTheDocument();

    await userEvent.click(button);
    const menu = screen.getByRole('navigation', { name: '网站菜单' });
    expect(screen.getByRole('button', { name: '关闭菜单' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login');
    expect(within(menu).getByRole('link', { name: '注册' })).toHaveAttribute('href', '/register');
    expect(within(menu).getByRole('combobox', { name: '界面语言' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: '订单' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: '网站菜单' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开菜单' })).toHaveFocus();
  });

  it('shows the account links when signed in and closes after following one or clicking outside', async () => {
    useLocaleStore.setState({ locale: 'en' });
    useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.invalid' }, 'menu-session');
    render(<Header />); await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('navigation', { name: 'Site menu' });
    for (const [name, href] of [['Account', '/profile'], ['Orders', '/orders'], ['My favorites', '/favorites']] as const) {
      expect(within(menu).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole('link', { name: 'Orders' }));
    expect(screen.queryByRole('navigation', { name: 'Site menu' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('navigation', { name: 'Site menu' })).not.toBeInTheDocument();
  });
});
