import { fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';
import api from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const errors = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { errors.push(message); }, success: vi.fn() };
  return { default: toast, toast };
});

const originalAdapter = api.defaults.adapter;
const pages: [string, ComponentType, [string, string][]][] = [
  ['login', LoginPage, [['email', 'customer@example.test'], ['password', 'private-test-password']]],
  ['register', RegisterPage, [['username', 'Customer'], ['email', 'customer@example.test'], ['password', 'private-test-password'], ['confirmPassword', 'private-test-password']]],
];

describe.each(pages)('failed %s', (route, Page, values) => {
  beforeEach(() => {
    errors.length = 0;
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('keeps visible feedback and both sessions, and never logs the request or its password', async () => {
    localStorage.setItem('session', 'current-customer');
    localStorage.setItem('user', JSON.stringify({ user_id: 1, username: 'current', email: 'current@example.test' }));
    localStorage.setItem('admin_token', 'current-admin');
    useAuthStore.getState().hydrate();
    window.history.replaceState(null, '', '/login?passwordChanged=1');
    const adapter: AxiosAdapter = async config => {
      throw Object.assign(new Error('Sensitive request failure'), { config, response: { status: 401, data: { error: '邮箱或密码错误' } } });
    };
    api.defaults.adapter = adapter;
    render(<Page />);
    await settle();

    for (const [name, value] of values) {
      // Login fields have no name attribute; each has a distinct type instead.
      const input = document.querySelector<HTMLInputElement>(route === 'register' ? `input[name="${name}"]` : `input[type="${name}"]`)!;
      fireEvent.change(input, { target: { name, value } });
    }
    fireEvent.submit(document.querySelector('form')!);
    await settle();

    expect(errors).toEqual(['邮箱或密码错误']);
    expect(window.location.pathname + window.location.search).toBe('/login?passwordChanged=1');
    expect(localStorage.getItem('session')).toBe('current-customer');
    expect(localStorage.getItem('admin_token')).toBe('current-admin');
    expect(router.push).not.toHaveBeenCalled();
    if (route === 'login') expect(screen.getByText('密码已修改，请使用新密码登录')).toBeInTheDocument();

    const logs = vi.mocked(logger.error).mock.calls;
    expect(logs).toHaveLength(1);
    for (const value of logs[0]) expect(typeof value, 'credential-bearing errors must not reach the logger').toBe('string');
    expect(JSON.stringify(logs)).not.toContain('private-test-password');
    expect(JSON.stringify(logs)).not.toContain('customer@example.test');
  });
});
