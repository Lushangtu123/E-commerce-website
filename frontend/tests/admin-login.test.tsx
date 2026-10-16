import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLoginPage from '@/app/admin/login/page';
import api from '@/lib/api';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const toasts = vi.hoisted(() => [] as [string, string][]);
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { success: (message: string) => { toasts.push(['success', message]); }, error: (message: string) => { toasts.push(['error', message]); } };
  return { default: toast, toast };
});

const admin = { admin_id: 1, username: 'root', role_name: '管理员' };
type Respond = () => Promise<Partial<Response>>;
const json = (status: number, body: unknown): Respond => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });

/** Each route answers from its own handler; the second factor defaults to `respond`. */
function setup(respond: Respond, routes: Record<string, Respond> = {}) {
  api.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { message: '已退出登录' } });
  // The page falls back to the same-origin API when no backend address is configured.
  vi.stubEnv('NEXT_PUBLIC_API_URL', '');
  const handlers: Record<string, Respond> = {
    '/api/admin/login': json(200, { two_factor: 'verify', challenge: 'challenge-1' }),
    '/api/admin/login/2fa': respond,
    ...routes,
  };
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async url => (await handlers[url]()) as Response);
  vi.stubGlobal('fetch', fetch);
  render(<AdminLoginPage />);
  return fetch;
}

async function enterPassword() {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'root' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
  fireEvent.submit(document.querySelector('form')!);
  await settle();
}

async function enterCode(code = '123456') {
  fireEvent.change(screen.getByLabelText('验证码'), { target: { value: code } });
  fireEvent.submit(document.querySelector('form')!);
  await settle();
}

async function signIn() {
  await enterPassword();
  await enterCode();
}

describe('admin login', () => {
  beforeEach(() => {
    toasts.length = 0;
  });

  it('labels its inputs for assistive technology and password managers', async () => {
    setup(json(200, {}));

    expect(Array.from(document.querySelectorAll('label'), label => label.htmlFor)).toEqual(['admin-username', 'admin-password']);
    expect(screen.getByLabelText('用户名')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
    await enterPassword();
    expect(screen.getByLabelText('验证码')).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('asks for the second factor after the password, then stores only a sign-in id and opens the dashboard', async () => {
    const fetch = setup(json(200, { token: 'admin-signed-token', admin }));

    await enterPassword();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(JSON.parse(String(init.body))).toEqual({ username: 'root', password: 'secret-pass' });
    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();

    await enterCode(' 123456 ');
    expect(fetch).toHaveBeenCalledTimes(2);
    const [verifyUrl, verifyInit] = fetch.mock.calls[1];
    expect(verifyUrl).toBe('/api/admin/login/2fa');
    expect(JSON.parse(String(verifyInit.body))).toEqual({ challenge: 'challenge-1', code: '123456' });
    // A cross-origin API's Set-Cookie only counts with credentials.
    expect(verifyInit.credentials).toBe('include');
    expect(new Headers(verifyInit.headers).get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(localStorage.getItem('admin_session')).toEqual(expect.any(String));
    expect(Object.values(localStorage).join()).not.toContain('admin-signed-token');
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toEqual(admin);
    expect(router.push.mock.calls).toEqual([['/admin/dashboard']]);
  });

  it('binds an authenticator on first sign-in and shows the recovery codes once before the dashboard', async () => {
    const codes = Array.from({ length: 10 }, (_, index) => `code${index}-abcde`);
    const fetch = setup(json(500, {}), {
      '/api/admin/login': json(200, { two_factor: 'setup', challenge: 'challenge-2' }),
      '/api/admin/login/2fa/setup': json(200, { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }),
      '/api/admin/login/2fa/activate': json(200, { admin, recovery_codes: codes }),
    });

    await enterPassword();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/login', '/api/admin/login/2fa/setup']);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ challenge: 'challenge-2' });
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');

    await enterCode();
    expect(fetch.mock.calls[2][0]).toBe('/api/admin/login/2fa/activate');
    expect(localStorage.getItem('admin_session')).toEqual(expect.any(String));
    expect(Array.from(screen.getByRole('list', { name: '恢复码' }).querySelectorAll('li'), item => item.textContent)).toEqual(codes);
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '我已保存，进入后台' }));
    expect(router.push.mock.calls).toEqual([['/admin/dashboard']]);
  });

  it('warns when a recovery code sign-in leaves few codes', async () => {
    setup(json(200, { admin, recovery_codes_remaining: 2 }));

    await signIn();
    expect(toasts).toEqual([['error', '恢复码只剩 2 个，请尽快重置两步验证以生成新的恢复码'], ['success', '登录成功']]);
  });

  it('keeps the code step after a wrong code and returns to the password after an expired challenge', async () => {
    let answer = json(401, { error: '验证码错误' });
    setup(() => answer());

    await signIn();
    expect(toasts).toEqual([['error', '验证码错误']]);
    expect(screen.getByLabelText('验证码')).toBeEnabled();

    answer = json(401, { error: '验证已过期，请重新输入密码' });
    await enterCode();
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(localStorage.getItem('admin_session')).toBeNull();
  });

  it('rejects a wrong password without asking for a code', async () => {
    setup(json(200, { admin }), { '/api/admin/login': json(401, { error: '用户名或密码错误' }) });

    await enterPassword();
    expect(toasts).toEqual([['error', '用户名或密码错误']]);
    expect(screen.queryByLabelText('验证码')).toBeNull();
    expect(document.querySelector('button[type="submit"]')).toBeEnabled();
  });

  it.each([
    ['a rejection', json(401, { error: '验证码错误' }), '验证码错误'],
    ['a success without an administrator', json(200, { token: 'admin-signed-token' }), '管理员登录结果尚未确认，请重新登录'],
    ['a success with a malformed administrator', json(200, { admin: 'root' }), '管理员登录结果尚未确认，请重新登录'],
    ['a non-JSON gateway error', async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }), '管理员登录结果尚未确认，请重新登录'],
    ['an unreachable server', async () => { throw new TypeError('Failed to fetch'); }, '管理员登录结果尚未确认，请重新登录'],
  ] as [string, Respond, string][])('never stores a session after %s and lets the form be used again', async (_, respond, message) => {
    setup(respond);

    await signIn();
    expect(localStorage.getItem('admin_session')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(toasts).toEqual([['error', message]]);
    expect(document.querySelector('button[type="submit"]')).toBeEnabled();
  });
});
