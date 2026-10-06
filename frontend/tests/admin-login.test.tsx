import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLoginPage from '@/app/admin/login/page';
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

function setup(respond: Respond) {
  // The page falls back to the same-origin API when no backend address is configured.
  vi.stubEnv('NEXT_PUBLIC_API_URL', '');
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => (await respond()) as Response);
  vi.stubGlobal('fetch', fetch);
  render(<AdminLoginPage />);
  return fetch;
}

async function signIn() {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'root' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
  fireEvent.submit(document.querySelector('form')!);
  await settle();
}

describe('admin login', () => {
  beforeEach(() => {
    toasts.length = 0;
  });

  it('labels its inputs for assistive technology and password managers', () => {
    setup(json(200, {}));

    expect(Array.from(document.querySelectorAll('label'), label => label.htmlFor)).toEqual(['admin-username', 'admin-password']);
    expect(screen.getByLabelText('用户名')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('stores the session and opens the dashboard after a successful login', async () => {
    const fetch = setup(json(200, { token: 'admin-token', admin }));

    await signIn();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(JSON.parse(String(init.body))).toEqual({ username: 'root', password: 'secret-pass' });
    expect(localStorage.getItem('admin_token')).toBe('admin-token');
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toEqual(admin);
    expect(router.push.mock.calls).toEqual([['/admin/dashboard']]);
  });

  it.each([
    ['a rejection', json(401, { error: '用户名或密码错误' }), '用户名或密码错误'],
    ['a response without a token', json(200, { admin }), '登录失败'],
    ['an empty token', json(200, { token: '', admin }), '登录失败'],
    ['a non-JSON gateway error', async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }), '登录失败，请稍后重试'],
    ['an unreachable server', async () => { throw new TypeError('Failed to fetch'); }, '登录失败，请稍后重试'],
  ] as [string, Respond, string][])('never stores a session after %s and lets the form be used again', async (_, respond, message) => {
    setup(respond);

    await signIn();

    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(toasts).toEqual([['error', message]]);
    expect(document.querySelector('button[type="submit"]')).toBeEnabled();
  });
});
