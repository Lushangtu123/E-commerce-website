import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AdminLayout from '@/components/AdminLayout';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/orders' }));

const labels = {
  'zh-CN': { toggle: '切换侧栏', close: '关闭侧栏', orders: '订单管理', logout: '退出登录' },
  en: { toggle: 'Toggle sidebar', close: 'Close sidebar', orders: 'Orders', logout: 'Sign out' },
};

async function setup(locale: Locale) {
  useLocaleStore.setState({ locale });
  localStorage.setItem('admin_session', 'sidebar-fixture-session');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'fixture' }));
  render(<AdminLayout><button>Page action</button></AdminLayout>);
  await settle();
  const toggle = screen.getByRole('button', { name: labels[locale].toggle });
  const sidebar = screen.getByRole('navigation').parentElement!;
  return { toggle, sidebar };
}

describe.each(['zh-CN', 'en'] as const)('admin sidebar keyboard access (%s)', locale => {
  it('removes the closed sidebar from the accessibility tree and restores its links when reopened', async () => {
    const { toggle } = await setup(locale);
    const orders = screen.getByRole('link', { name: labels[locale].orders });
    expect(orders).toHaveAttribute('href', '/admin/orders');
    expect(orders).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: labels[locale].logout })).toBeEnabled();

    fireEvent.click(toggle);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels[locale].logout })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: labels[locale].orders })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole('link', { name: labels[locale].orders })).toHaveAttribute('href', '/admin/orders');
    expect(screen.getByRole('button', { name: labels[locale].logout })).toBeEnabled();
  });

  it('skips closed sidebar controls in both keyboard directions', async () => {
    const { toggle, sidebar } = await setup(locale);
    fireEvent.click(toggle);
    for (const shift of [false, true]) {
      toggle.focus();
      for (let index = 0; index < 6; index++) {
        await userEvent.tab({ shift });
        expect(sidebar.contains(document.activeElement)).toBe(false);
      }
    }
  });

  it('returns focus to the visible toggle when closed from inside the sidebar', async () => {
    const { toggle } = await setup(locale);
    const close = screen.getByRole('button', { name: labels[locale].close });
    close.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('announces the controlled sidebar and its current expanded state', async () => {
    const { toggle, sidebar } = await setup(locale);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.getAttribute('aria-controls')).toBe(sidebar.id);
    expect(sidebar.id).not.toBe('');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
