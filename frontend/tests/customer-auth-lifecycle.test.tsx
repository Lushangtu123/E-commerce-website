import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';
import api, { userApi } from '@/lib/api';
import { signOut } from '@/lib/sign-out';
import { useAuthStore } from '@/store/useAuthStore';
import { apiError, deferred, render, settle, submitTogether } from './helpers';

const routing = vi.hoisted(() => ({ navigate: null as null | ((path: string) => void), pushes: [] as string[] }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: (path: string) => { routing.pushes.push(path); routing.navigate?.(path); } }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) =>
  <a {...rest} href={href} onClick={event => { event.preventDefault(); routing.navigate?.(href!); }}>{children}</a> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: notices }));

const userA = { user_id: 1, username: 'Account A', email: 'a@example.test' };
const userB = { user_id: 2, username: 'Account B', email: 'b@example.test' };
const originalAdapter = api.defaults.adapter;
let requests: string[];
let cookieUser: number | null;
let finishPending: (() => void)[];

function pending() {
  const answer = deferred<unknown>();
  finishPending.push(() => answer.resolve({ user: userA }));
  return answer;
}

/** Model the browser applying Set-Cookie before axios hands the response to the page. */
function serve(routes: Record<string, () => unknown>) {
  const adapter: AxiosAdapter = async config => {
    const route = `${config.method?.toUpperCase()} ${config.url}`;
    requests.push(route);
    if (!routes[route]) throw new Error(`Unexpected request ${route}`);
    const data = await routes[route]();
    if (route === 'POST /users/logout' || route.includes('/users/password')) cookieUser = null;
    else if (data && typeof data === 'object' && 'user' in data) cookieUser = (data as { user: typeof userA }).user?.user_id ?? null;
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

function RoutedPages({ initial = '/login' }: { initial?: string }) {
  const [path, setPath] = useState(initial);
  useEffect(() => { routing.navigate = setPath; return () => { routing.navigate = null; }; }, []);
  return path === '/login' ? <LoginPage /> : path === '/register' ? <RegisterPage /> : <p>Home</p>;
}

function fill(route: 'login' | 'register', account = userA) {
  if (route === 'register') fireEvent.change(screen.getByLabelText('用户名'), { target: { value: account.username } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: account.email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private password 123' } });
  if (route === 'register') fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'private password 123' } });
}

beforeEach(() => {
  requests = []; cookieUser = null; finishPending = []; routing.pushes = []; routing.navigate = null;
});
afterEach(async () => {
  finishPending.forEach(finish => finish());
  await settle();
  api.defaults.adapter = originalAdapter;
});

describe.each(['login', 'register'] as const)('customer %s lifecycle', route => {
  const endpoint = `POST /users/${route}`;
  const Page = route === 'login' ? LoginPage : RegisterPage;

  it('publishes a valid sign-in once and navigates normally', async () => {
    serve({ [endpoint]: () => ({ user: userA }) });
    render(<RoutedPages initial={`/${route}`} />);
    await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!);
    await settle();
    expect(requests).toEqual([endpoint]);
    expect(useAuthStore.getState().user).toEqual(userA);
    expect(cookieUser).toBe(1);
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual(userA);
    expect(routing.pushes).toEqual(['/']);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(notices.success).toHaveBeenCalledTimes(1);
  });

  it('locks duplicate submissions synchronously before React commits', async () => {
    const answer = pending();
    serve({ [endpoint]: () => answer.promise });
    render(<Page />); await settle(); fill(route);
    const form = document.querySelector('form')!;
    submitTogether(form, form);
    await settle();
    expect(requests).toEqual([endpoint]);
    answer.resolve({ user: userA }); await settle();
    expect(notices.success).toHaveBeenCalledTimes(1);
  });

  it('clears an abandoned successful response without storing or announcing it', async () => {
    const answer = pending();
    serve({ [endpoint]: () => answer.promise, 'POST /users/logout': () => ({ message: '已退出登录' }) });
    const view = render(<Page />); await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!); await settle(); view.unmount();
    answer.resolve({ user: userA }); await settle();
    expect(requests).toEqual([endpoint, 'POST /users/logout']);
    expect(cookieUser).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('session')).toBeNull();
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).not.toHaveBeenCalled();
    expect(routing.pushes).toEqual([]);
  });

  it('ignores a definite failure after unmount', async () => {
    const answer = pending();
    serve({ [endpoint]: () => answer.promise });
    const view = render(<Page />); await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!); await settle(); view.unmount();
    answer.reject(apiError('邮箱或密码错误')); await settle();
    expect(requests).toEqual([endpoint]);
    expect(notices.error).not.toHaveBeenCalled();
    expect(notices.success).not.toHaveBeenCalled();
    expect(routing.pushes).toEqual([]);
  });

  it('preserves the form after a definite rejection and permits a corrected submission', async () => {
    let calls = 0;
    serve({ [endpoint]: () => { if (calls++ === 0) throw apiError('邮箱或密码错误'); return { user: userA }; } });
    render(<Page />); await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(notices.error).toHaveBeenCalledWith('邮箱或密码错误');
    expect(screen.getByLabelText('邮箱')).toHaveValue(userA.email);
    expect(screen.getByRole('button', { name: route === 'login' ? '登录' : '注册' })).not.toBeDisabled();
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual([endpoint, endpoint]);
    expect(useAuthStore.getState().user).toEqual(userA);
  });

  it.each([null, {}, { user: {} }, { user: { ...userA, user_id: '1' } }, { user: { ...userA, email: null } }])('clears an unexpected successful body %j instead of publishing it', async body => {
    serve({ [endpoint]: () => body, 'POST /users/logout': () => ({ message: '已退出登录' }) });
    render(<Page />); await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual([endpoint, 'POST /users/logout']);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('user')).toBeNull();
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).toHaveBeenCalledTimes(1);
    expect(routing.pushes).toEqual([]);
  });

  it('discards a result after the stored tab identity changes', async () => {
    const answer = pending();
    serve({ [endpoint]: () => answer.promise, 'POST /users/logout': () => ({ message: '已退出登录' }) });
    render(<Page />); await settle(); fill(route);
    fireEvent.submit(document.querySelector('form')!); await settle();
    localStorage.setItem('session', 'other-tab');
    localStorage.setItem('user', JSON.stringify(userB));
    answer.resolve({ user: userA }); await settle();
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('session')).toBe('other-tab');
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual(userB);
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).not.toHaveBeenCalled();
    expect(routing.pushes).toEqual([]);
  });
});

describe('customer cookie mutation order across actual routed pages', () => {
  it('clears a lost sign-in result without resending credentials', async () => {
    serve({ 'POST /users/login': () => { cookieUser = 1; throw new Error('Lost reply'); },
      'POST /users/logout': () => ({ message: '已退出登录' }) });
    render(<LoginPage />); await settle(); fill('login');
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual(['POST /users/login', 'POST /users/logout']);
    expect(cookieUser).toBeNull(); expect(useAuthStore.getState().user).toBeNull();
    expect(notices.error).toHaveBeenCalledWith('登录结果尚未确认，请重新登录');
  });

  it('requires successful cookie cleanup before a later registration after failed abandoned cleanup', async () => {
    const answer = pending(); let clears = 0;
    serve({ 'POST /users/login': () => answer.promise, 'POST /users/register': () => ({ user: userB }),
      'POST /users/logout': () => { if (++clears === 1) throw new Error('Cleanup unavailable'); return { message: '已退出登录' }; } });
    const first = render(<LoginPage />); await settle(); fill('login');
    fireEvent.submit(document.querySelector('form')!); await settle(); first.unmount();
    answer.resolve({ user: userA }); await settle();
    expect(localStorage.getItem('customer_session_cleanup_pending')).toBe('1');
    expect(useAuthStore.getState().user).toBeNull();
    render(<RegisterPage />); await settle(); fill('register', userB);
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual(['POST /users/login', 'POST /users/logout', 'POST /users/logout', 'POST /users/register']);
    expect(cookieUser).toBe(2); expect(useAuthStore.getState().user).toEqual(userB);
    expect(localStorage.getItem('customer_session_cleanup_pending')).toBeNull();
  });

  it('releases the local queue when Web Locks throws synchronously', async () => {
    let attempts = 0;
    vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => Promise<unknown>) => {
      if (++attempts === 1) throw new Error('Lock unavailable');
      return Promise.resolve(run());
    } } });
    serve({ 'POST /users/logout': () => ({ message: '已退出登录' }) });
    await expect(userApi.logout()).rejects.toThrow('Lock unavailable');
    await expect(userApi.logout()).resolves.toEqual({ message: '已退出登录' });
    expect(requests).toEqual(['POST /users/logout']);
  });
  it('finishes and cleans abandoned login A before sending register B through the live link', async () => {
    const answer = pending(), cleanup = pending();
    serve({ 'POST /users/login': () => answer.promise, 'POST /users/register': () => ({ user: userB }), 'POST /users/logout': () => cleanup.promise });
    render(<RoutedPages />); await settle(); fill('login');
    fireEvent.submit(document.querySelector('form')!); await settle();
    fireEvent.click(screen.getByRole('link', { name: '立即注册' })); await settle();
    fill('register', userB); fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual(['POST /users/login']);
    answer.resolve({ user: userA }); await settle();
    expect(requests).toEqual(['POST /users/login', 'POST /users/logout']);
    expect(useAuthStore.getState().user).toBeNull();
    cleanup.resolve({ message: '已退出登录' }); await settle();
    expect(requests).toEqual(['POST /users/login', 'POST /users/logout', 'POST /users/register']);
    expect(cookieUser).toBe(2);
    expect(useAuthStore.getState().user).toEqual(userB);
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual(userB);
    expect(routing.pushes).toEqual(['/']);
    expect(notices.success).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending logout from clearing the cookie of a later sign-in', async () => {
    const answer = pending();
    act(() => useAuthStore.getState().login(userA, 'session-a')); cookieUser = 1;
    serve({ 'POST /users/logout': () => answer.promise, 'POST /users/login': () => ({ user: userB }) });
    const logout = signOut();
    render(<RoutedPages />); await settle(); fill('login', userB);
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual(['POST /users/logout']);
    answer.resolve({ message: '已退出登录' }); await logout; await settle();
    expect(requests).toEqual(['POST /users/logout', 'POST /users/login']);
    expect(cookieUser).toBe(2);
    expect(useAuthStore.getState().user).toEqual(userB);
  });

  it.each(['change', 'reset'] as const)('waits for a pending %s password cookie clear before signing in', async kind => {
    const answer = pending();
    act(() => useAuthStore.getState().login(userA, 'session-a')); cookieUser = 1;
    const route = kind === 'change' ? 'PUT /users/password' : 'POST /users/password/reset';
    serve({ [route]: () => answer.promise, 'POST /users/login': () => ({ user: userB }) });
    const passwordWrite = kind === 'change' ? userApi.changePassword({ currentPassword: 'old password 123', newPassword: 'new password 123' }) : userApi.resetPassword({ token: 'a'.repeat(64), newPassword: 'new password 123' });
    render(<RoutedPages />); await settle(); fill('login', userB);
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toEqual([route]);
    answer.resolve({ reauthenticate: true }); await passwordWrite; await settle();
    expect(requests).toEqual([route, 'POST /users/login']);
    expect(cookieUser).toBe(2);
    expect(useAuthStore.getState().user).toEqual(userB);
  });
});
