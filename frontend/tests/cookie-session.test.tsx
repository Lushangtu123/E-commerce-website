import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import AppShell from '@/components/AppShell';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: vi.fn(), success: vi.fn() };
  return { default: toast, toast, Toaster: () => null };
});
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));
vi.mock('@/lib/api', () => ({ userApi: { login: vi.fn() } }));

const first = { user_id: 1, username: 'first', email: 'first@example.test' };
const second = { user_id: 2, username: 'second', email: 'second@example.test' };

describe('cookie sessions in the browser', () => {
  it('keeps the signed token out of storage after a login and names the sign-in itself', async () => {
    vi.mocked(userApi.login).mockImplementation(async (_data, attempt) => {
      const session = { user: first, token: 'server-signed-token' };
      attempt?.commit(session);
      return session;
    });
    render(<LoginPage />);
    fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: 'first@example.test' } });
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'example-password' } });
    fireEvent.submit(document.querySelector('form')!);
    await settle();

    const { sessionId, user } = useAuthStore.getState();
    expect(user).toEqual(first);
    expect(sessionId).toEqual(expect.any(String));
    expect(sessionId).not.toBe('server-signed-token');
    expect(Object.values(localStorage).join()).not.toContain('server-signed-token');
  });

  it('follows a sign-in another tab stores under the session key', async () => {
    useAuthStore.getState().login(first, 'first-session');
    render(<AppShell>page</AppShell>);
    await settle();

    localStorage.setItem('session', 'second-session');
    localStorage.setItem('user', JSON.stringify(second));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: 'session' })); });

    expect(useAuthStore.getState()).toMatchObject({ sessionId: 'second-session', user: second });
  });
});
