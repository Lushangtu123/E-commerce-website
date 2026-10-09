import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChangePassword from '@/components/ChangePassword';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const accountA = { user_id: 1, username: 'Account A', email: 'a@example.test' };
const accountB = { user_id: 2, username: 'Account B', email: 'b@example.test' };

it.each(['unchanged', 'account', 'session', 'storage', 'user-storage', 'unmount'] as const)(
  'binds a queued password request to its submitting identity across %s', async change => {
    const gate = deferred<void>();
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => {
      await gate.promise; return run();
    } } });
    let cookieUser: number | null = 1;
    const passwords = new Map([[1, 'SharedOriginal123!'], [2, 'SharedOriginal123!']]);
    const requests: { identity: string | null; body: object }[] = [];
    api.defaults.adapter = async config => {
      const body = JSON.parse(config.data);
      requests.push({ identity: localStorage.getItem('session'), body });
      expect(config.url).toBe('/users/password');
      expect(body.currentPassword).toBe(passwords.get(cookieUser!));
      passwords.set(cookieUser!, body.newPassword); cookieUser = null;
      return { data: { message: '密码已修改，请重新登录', reauthenticate: true }, status: 200, statusText: 'OK', headers: {}, config };
    };
    useAuthStore.getState().login(accountA, 'session-a');
    const view = render(<ChangePassword />); await settle();
    for (const [label, value] of [['当前密码', 'SharedOriginal123!'], ['新密码', 'PasswordIntendedForA456!'], ['确认新密码', 'PasswordIntendedForA456!']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toHaveLength(0);
    if (change === 'account') act(() => { cookieUser = 2; useAuthStore.getState().login(accountB, 'session-b'); });
    if (change === 'session') act(() => useAuthStore.getState().login(accountA, 'session-new'));
    if (change === 'storage') { cookieUser = 2; localStorage.setItem('session', 'session-b'); localStorage.setItem('user', JSON.stringify(accountB)); }
    if (change === 'user-storage') { cookieUser = 2; localStorage.setItem('user', JSON.stringify(accountB)); }
    if (change === 'unmount') view.unmount();
    await settle(); gate.resolve(); await settle();
    if (change === 'unchanged') {
      expect(requests).toEqual([{ identity: 'session-a', body: { currentPassword: 'SharedOriginal123!', newPassword: 'PasswordIntendedForA456!' } }]);
      expect(passwords.get(1)).toBe('PasswordIntendedForA456!'); expect(cookieUser).toBeNull();
      expect(router.push).toHaveBeenCalledWith('/login?passwordChanged=1');
    } else {
      expect(requests).toEqual([]);
      expect(passwords.get(1)).toBe('SharedOriginal123!'); expect(passwords.get(2)).toBe('SharedOriginal123!');
      expect(cookieUser).toBe(['account', 'storage', 'user-storage'].includes(change) ? 2 : 1);
      expect(router.push).not.toHaveBeenCalled();
    }
  }
);
