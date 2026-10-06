import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import { userApi } from '@/lib/api';
import { logger } from '@/lib/logger';
import { signOut } from '@/lib/sign-out';
import { useAuthStore } from '@/store/useAuthStore';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  userApi: { logout: vi.fn() },
  searchApi: { getHistory: vi.fn(async () => ({ history: [] })), getHot: vi.fn(async () => ({ keywords: [] })), record: vi.fn(), deleteKeyword: vi.fn() },
}));

const customer = { user_id: 1, username: 'buyer', email: 'buyer@example.test' };

describe('signOut', () => {
  it('signs out in every tab before the server answers, then clears the cookie through the API', async () => {
    const answer = deferred<{ message: string }>();
    vi.mocked(userApi.logout).mockReturnValue(answer.promise);
    useAuthStore.getState().login(customer, 'buyer-session');

    const done = signOut();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('session')).toBeNull();
    expect(userApi.logout).toHaveBeenCalledTimes(1);

    answer.resolve({ message: '已退出登录' });
    await done;
  });

  it('stays signed out and logs the failure when the server cannot clear the cookie', async () => {
    vi.mocked(userApi.logout).mockRejectedValue(new Error('offline'));
    useAuthStore.getState().login(customer, 'buyer-session');

    await expect(signOut()).resolves.toBeUndefined();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('退出登录失败:', expect.any(Error));
  });
});

describe('header sign-out', () => {
  it('leaves the page only after the server has cleared the session cookie', async () => {
    const answer = deferred<{ message: string }>();
    vi.mocked(userApi.logout).mockReturnValue(answer.promise);
    window.history.replaceState(null, '', '/profile');
    useAuthStore.getState().login(customer, 'buyer-session');
    render(<Header />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await settle();
    expect(localStorage.getItem('session')).toBeNull();
    // A full page load would cancel the request that clears the cookie.
    expect(window.location.pathname).toBe('/profile');

    await act(async () => answer.resolve({ message: '已退出登录' }));
    await settle();
    expect(window.location.pathname).toBe('/');
  });
});
