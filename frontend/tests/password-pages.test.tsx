import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '@/app/forgot-password/page';
import SettingsPage from '@/app/profile/settings/page';
import ResetPasswordPage from '@/app/reset-password/page';
import LoginPage from '@/app/login/page';
import ChangePassword from '@/components/ChangePassword';
import api, { paymentApi, userApi } from '@/lib/api';
import { passwordError } from '@/lib/password-validation';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { CommitLog, apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/settings' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
// Renders the real component and records the props the settings page passes it.
vi.mock('@/components/ChangePassword', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ChangePassword')>();
  return { default: vi.fn(actual.default) };
});

type Handler = (body: Record<string, unknown>) => unknown;

const customer = { user_id: 1, username: 'Customer', email: 'customer@test' };
const replacement = { user_id: 2, username: 'Replacement', email: 'replacement@test' };
const resetToken = 'a'.repeat(64);
const changed = { message: '密码已修改，请重新登录', reauthenticate: true };
const unconfirmedLogin = '/login?passwordChangeUnconfirmed=1';
const unconfirmedMessage = '修改密码结果尚未确认，请先尝试用新密码登录；若无法登录，请使用密码找回';
const originalAdapter = api.defaults.adapter;
let requests: InternalAxiosRequestConfig[] = [];
let payloads: Record<string, unknown>[] = [];

/** Answers the real API client by "METHOD /path"; bodies sent to handlers are recorded as payloads. */
function serve(routes: Record<string, Handler>) {
  const adapter: AxiosAdapter = async config => {
    requests.push(config);
    const route = `${config.method?.toUpperCase()} ${config.url}`;
    const body = config.data ? JSON.parse(config.data) : {};
    if (config.method !== 'get') payloads.push(body);
    const handler = routes[route];
    if (!handler) throw new Error(`Unexpected request ${route}`);
    return { data: await handler(body), status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const passwordFields = (root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]'));
const form = () => document.querySelector('form');
const signInCustomer = () => useAuthStore.getState().login(customer, 'session-a');

beforeEach(() => {
  requests = [];
  payloads = [];
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('change password', () => {
  async function setup(change: Handler = async () => changed) {
    signInCustomer();
    serve({ 'PUT /users/password': change });
    const commits: HTMLElement[] = [];
    const view = render(<CommitLog commits={commits}><ChangePassword /></CommitLog>);
    await settle();
    return { view, commits };
  }

  function fill(values = { current: ' previous password ', next: ' next password 123 ', confirm: ' next password 123 ' }) {
    for (const [name, value] of Object.entries(values)) fireEvent.change(field(name), { target: { value } });
  }

  it('keeps whitespace, revokes the invoking session and clears its cart only after success', async () => {
    const pending = deferred();
    await setup(() => pending.promise);
    useCartStore.getState().setItems([{ cart_id: 1, product_id: 1, title: 'Item', quantity: 1, stock: 2, price: 10 }]);
    fill();

    submitTogether(form()!, form()!);
    expect(payloads).toEqual([{ currentPassword: ' previous password ', newPassword: ' next password 123 ' }]);
    await settle();
    for (const input of passwordFields()) expect(input).toBeDisabled();
    expect(useAuthStore.getState().sessionId).toBe('session-a');

    await act(async () => pending.resolve(changed));
    await settle();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('session')).toBeNull();
    expect(useCartStore.getState().getTotalCount()).toBe(0);
    expect(router.push.mock.calls).toEqual([['/login?passwordChanged=1']]);
  });

  it.each([undefined, 408, 409, 429, 500, 503])('ends the invoking session without retrying when the password result is unknown (status %s)', async status => {
    const pending = deferred();
    await setup(() => pending.promise);
    localStorage.setItem('admin_session', 'admin-a');
    useCartStore.getState().setItems([{ cart_id: 1, product_id: 1, title: 'Item', quantity: 1, stock: 2, price: 10 }]);
    fill();
    const obsoleteSubmit = captureHandler(form()!, 'onSubmit');
    submitTogether(form()!, form()!);
    expect(payloads).toHaveLength(1);

    // The server may have committed the new password before the reply was lost.
    await act(async () => pending.reject(status ? Object.assign(new Error('Unavailable'), { response: { status, data: { error: '服务暂不可用' } } }) : new Error('Lost reply')));
    await settle();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('session')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('admin_session')).toBe('admin-a');
    expect(useCartStore.getState().getTotalCount()).toBe(0);
    expect(passwordFields()).toHaveLength(0);
    expect(router.push.mock.calls).toEqual([[unconfirmedLogin]]);
    await obsoleteSubmit();
    expect(requests.map(request => `${request.method} ${request.url}`)).toEqual(['put /users/password']);

    act(() => useAuthStore.getState().login(customer, 'session-new'));
    await settle();
    for (const input of passwordFields()) expect(input).toHaveValue('');
  });

  it.each([{}, null, { reauthenticate: false }, { reauthenticate: 'true' }])('requires an explicit success acknowledgement and recovers from a malformed body %j', async body => {
    await setup(() => body);
    fill();
    fireEvent.submit(form()!);
    await settle();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(passwordFields()).toHaveLength(0);
    expect(router.push.mock.calls).toEqual([[unconfirmedLogin]]);
    expect(payloads).toHaveLength(1);
  });

  it('keeps drafts and the current session when the server definitely rejects the current password', async () => {
    await setup(() => { throw apiError('当前密码错误'); });
    fill();
    fireEvent.submit(form()!);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('当前密码错误');
    expect(field('current')).toHaveValue(' previous password ');
    expect(field('next')).toHaveValue(' next password 123 ');
    expect(field('confirm')).toHaveValue(' next password 123 ');
    expect(useAuthStore.getState().sessionId).toBe('session-a');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not turn the API client session-expired response into a successful or unknown password change', async () => {
    await setup();
    api.defaults.adapter = async config => {
      throw Object.assign(new Error('Expired'), { config, response: { config, status: 401, data: { error: '登录已失效' } } });
    };
    fill();
    fireEvent.submit(form()!);
    await settle();

    expect(localStorage.getItem('session')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByText('密码已修改，请使用新密码登录')).not.toBeInTheDocument();
  });

  it.each([
    ['too short', 'short', 'short'],
    ['mismatched', ' valid password 123 ', 'different password'],
    ['whitespace only', ' '.repeat(12), ' '.repeat(12)],
    ['over 72 UTF-8 bytes', '密'.repeat(25), '密'.repeat(25)],
  ])('rejects a %s new password before sending', async (_, next, confirm) => {
    await setup();
    fill({ current: 'old', next, confirm });

    fireEvent.submit(form()!);
    await settle();

    expect(payloads).toEqual([]);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('never shows a replacement customer the old drafts and ignores the old submit handler', async () => {
    const { commits } = await setup();
    fill();
    const staleSubmit = captureHandler(form()!, 'onSubmit');

    const before = commits.length;
    act(() => useAuthStore.getState().login(replacement, 'session-b'));
    for (const input of passwordFields(commits[before])) expect(input, 'the first replacement render must hide the old draft').toHaveValue('');
    await staleSubmit();
    expect(payloads).toEqual([]);

    await settle();
    for (const input of passwordFields()) expect(input).toHaveValue('');
  });

  const lateCases = (['account', 'same-customer-session', 'storage', 'stored-account', 'unmount'] as const).flatMap(change =>
    (['success', 'failure', 'unknown'] as const).map(outcome => ({ change, outcome })));

  it.each(lateCases)('neither signs out, navigates nor reports a late $outcome after a $change change', async ({ change, outcome }) => {
    const pending = deferred();
    const { view } = await setup(() => pending.promise);
    fill();
    fireEvent.submit(form()!);

    if (change === 'account') {
      act(() => useAuthStore.getState().login(replacement, 'session-b'));
      await settle();
    }
    if (change === 'same-customer-session') {
      act(() => useAuthStore.getState().login(customer, 'session-b'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('session', 'session-b');
    if (change === 'stored-account') localStorage.setItem('user', JSON.stringify(replacement));
    if (change === 'unmount') view.unmount();
    useCartStore.getState().setItems([{ cart_id: 2, product_id: 2, title: 'Current cart', quantity: 2, stock: 3, price: 10 }]);
    await act(async () => {
      if (outcome === 'success') pending.resolve(changed);
      else if (outcome === 'unknown') pending.reject(new Error('Lost reply'));
      else pending.reject(apiError('当前密码错误'));
    });
    await settle();

    expect(router.push).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useCartStore.getState().getTotalCount()).toBe(2);
    expect(screen.queryByText('当前密码错误')).not.toBeInTheDocument();
  });
});

describe('forgot password', () => {
  async function setup({ capabilities = async () => ({ passwordResetAvailable: true }), send = async () => ({}) }: { capabilities?: Handler; send?: Handler } = {}) {
    serve({ 'GET /users/password/capabilities': capabilities, 'POST /users/password/forgot': send });
    render(<ForgotPasswordPage />);
    await settle();
  }

  it.each([
    ['the email service is off', async () => ({ passwordResetAvailable: false })],
    ['the capability check fails', async () => { throw new Error('Offline'); }],
  ])('stays unavailable when %s and sends no reset request', async (_, capabilities) => {
    await setup({ capabilities });
    expect(screen.getByRole('alert')).toHaveTextContent(_ === 'the email service is off' ? '密码找回邮件服务暂不可用' : '加载邮件服务状态失败，请重试');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'customer@example.test' } });
    fireEvent.submit(form()!);
    await settle();

    expect(payloads).toEqual([]);
    expect(screen.getByRole('button', { name: '发送重置邮件' })).toBeDisabled();
  });

  it('sends once and shows only a generic confirmation, never a returned reset URL', async () => {
    const pending = deferred();
    await setup({ send: () => pending.promise });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' customer@example.test ' } });

    submitTogether(form()!, form()!);
    expect(payloads).toEqual([{ email: 'customer@example.test' }]);
    await act(async () => pending.resolve({ message: 'https://secret.invalid', reset_url: 'https://secret.invalid/reset#token=DO-NOT-DISPLAY' }));
    await settle();

    expect(screen.getByText(/如果该邮箱已注册/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret.invalid');
    expect(document.body.textContent).not.toContain('DO-NOT-DISPLAY');
  });
});

describe('reset password', () => {
  async function setup({ url = `/reset-password#token=${resetToken}`, write = async () => ({}), strict = false }: { url?: string; write?: Handler; strict?: boolean } = {}) {
    window.history.replaceState(null, '', url);
    const replaceState = vi.spyOn(window.history, 'replaceState');
    serve({ 'POST /users/password/reset': write });
    render(strict ? <StrictMode><ResetPasswordPage /></StrictMode> : <ResetPasswordPage />);
    await settle();
    return replaceState;
  }

  function fill() {
    for (const input of passwordFields()) fireEvent.change(input, { target: { value: ' preserved reset password ' } });
  }

  it('keeps the token through a Strict Mode effect replay after removing its fragment, and never stores or shows it', async () => {
    const replaceState = await setup({ strict: true });

    expect(form(), 'a valid one-time token must survive the effect replay').not.toBeNull();
    expect(replaceState.mock.calls.map(([, , url]) => url)).toEqual(['/reset-password']);
    expect(window.location.hash).toBe('');
    expect(document.body.textContent).not.toContain(resetToken);
    expect(localStorage.getItem('session')).toBeNull();

    fill();
    fireEvent.submit(form()!);
    await settle();
    expect(payloads).toEqual([{ token: resetToken, newPassword: ' preserved reset password ' }]);
    expect(screen.getByText(/密码已重置/)).toBeInTheDocument();
    expect(form()).toBeNull();
  });

  it.each([
    ['a short token', '/reset-password#token=short'],
    ['a token in the query string', `/reset-password?token=${resetToken}`],
    ['extra fragment fields', `/reset-password#token=${resetToken}&other=1`],
  ])('keeps %s from reaching the API', async (_, url) => {
    await setup({ url });

    expect(screen.getByRole('alert')).toHaveTextContent('重置链接无效或已过期');
    expect(form()).toBeNull();
    expect(payloads).toEqual([]);
  });

  it('submits once and does not sign out a customer who signed in while the reset was pending', async () => {
    const pending = deferred();
    signInCustomer();
    await setup({ write: () => pending.promise });
    fill();

    submitTogether(form()!, form()!);
    expect(payloads).toHaveLength(1);
    act(() => useAuthStore.getState().login(replacement, 'session-b'));
    await act(async () => pending.resolve({}));
    await settle();

    expect(useAuthStore.getState().sessionId).toBe('session-b');
    expect(localStorage.getItem('session')).toBe('session-b');
  });

  it('discards an invalid token and offers a fresh request instead of resubmitting it', async () => {
    await setup({ write: async () => {
      throw Object.assign(new Error('Invalid'), { response: { status: 400, data: { error: '密码重置链接无效或已过期', code: 'INVALID_RESET_TOKEN' } } });
    } });
    fill();

    fireEvent.submit(form()!);
    await settle();

    expect(form()).toBeNull();
    expect(screen.getByRole('link', { name: '重新申请重置邮件' })).toBeInTheDocument();
    expect(payloads).toHaveLength(1);
  });
});

describe('password rules and credentials', () => {
  it('counts UTF-8 bytes and keeps meaningful leading spaces', () => {
    expect(passwordError('密'.repeat(24))).toBeNull();
    expect(passwordError('密'.repeat(25))).toBeTruthy();
    expect(passwordError(' password 123 ')).toBeNull();
    expect(passwordError(' '.repeat(12))).toBeTruthy();
  });

  it('keeps recovery and capability requests anonymous while a password change needs the invoking customer', async () => {
    localStorage.setItem('session', 'customer-a');
    localStorage.setItem('user', JSON.stringify(customer));
    localStorage.setItem('admin_session', 'admin-a');
    useAuthStore.getState().hydrate();
    localStorage.setItem('session', 'other-tab-customer');
    serve({
      'GET /users/password/capabilities': () => ({ passwordResetAvailable: true }), 'POST /users/password/forgot': () => ({}),
      'POST /users/password/reset': () => ({}), 'GET /payments/settings': () => ({ mode: 'disabled', canPay: false, isDemo: false }),
    });

    await userApi.passwordCapabilities();
    await userApi.forgotPassword('customer@example.test');
    await userApi.resetPassword({ token: resetToken, newPassword: 'new password 123' });
    await paymentApi.getSettings();
    for (const config of requests) expect(config.headers.get('Authorization'), 'public recovery requests carry no credentials').toBeFalsy();

    await expect(userApi.changePassword({ currentPassword: 'old', newPassword: 'new password 123' })).rejects.toThrow(/登录状态已变化/);
    expect(requests).toHaveLength(4);
  });
});

describe('settings page password change', () => {
  async function setup(change: Handler = () => changed) {
    signInCustomer();
    serve({ 'GET /users/profile': () => ({ user: customer }), 'PUT /users/password': change });
    render(<SettingsPage />);
    await settle();
  }

  it('keeps the success URL when the page reacts to the revoked session', async () => {
    await setup();
    fireEvent.change(field('current'), { target: { value: ' previous password ' } });
    fireEvent.change(field('next'), { target: { value: ' next password 123 ' } });
    fireEvent.change(field('confirm'), { target: { value: ' next password 123 ' } });

    // The page also has a profile form; submit the password one.
    fireEvent.submit(field('current').closest('form')!);
    await settle();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(router.push).toHaveBeenCalled();
    for (const [path] of router.push.mock.calls) expect(path, 'the page redirect must keep the password change notice').toBe('/login?passwordChanged=1');
  });

  it.each(['lost reply', 'malformed acknowledgement'])('keeps the unknown-result notice when logout rerenders the real settings page after a %s', async outcome => {
    await setup(() => {
      if (outcome === 'lost reply') throw new Error('Lost reply');
      return {};
    });
    fireEvent.change(field('current'), { target: { value: ' previous password ' } });
    fireEvent.change(field('next'), { target: { value: ' next password 123 ' } });
    fireEvent.change(field('confirm'), { target: { value: ' next password 123 ' } });
    fireEvent.submit(field('current').closest('form')!);
    await settle();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(router.push).toHaveBeenCalled();
    for (const [path] of router.push.mock.calls) expect(path).toBe(unconfirmedLogin);
    expect(requests.filter(request => request.method === 'put')).toHaveLength(1);
  });

  const staleCallbacks = (['session-loss', 'replacement'] as const).flatMap(scenario =>
    (['onPasswordChanged', 'onPasswordUnconfirmed'] as const).map(callback => ({ scenario, callback })));
  it.each(staleCallbacks)('still redirects to plain login after $scenario, even if an obsolete $callback callback reports a result', async ({ scenario, callback }) => {
    await setup();
    const oldProps = vi.mocked(ChangePassword).mock.lastCall![0];

    if (scenario === 'replacement') {
      act(() => useAuthStore.getState().login(replacement, 'session-b'));
      act(() => oldProps?.[callback]?.());
    }
    act(() => useAuthStore.getState().logout());
    if (scenario === 'session-loss') act(() => oldProps?.[callback]?.());
    await settle();

    expect(router.push.mock.lastCall).toEqual(['/login']);
  });
});

describe('login after an unconfirmed password change', () => {
  it.each(['?passwordChangeUnconfirmed=1', '?passwordChanged=1&passwordChangeUnconfirmed=1'])('shows clear recovery guidance for %s without sending credentials', async query => {
    window.history.replaceState(null, '', `/login${query}`);
    serve({});
    render(<LoginPage />);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmedMessage);
    expect(screen.queryByText('密码已修改，请使用新密码登录')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute('href', '/forgot-password');
    expect(requests).toHaveLength(0);
    expect(document.querySelector('input[type="password"]')).toHaveValue('');
  });

  it('updates the recovery guidance when the customer switches between Chinese and English', async () => {
    window.history.replaceState(null, '', unconfirmedLogin);
    serve({});
    render(<LoginPage />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmedMessage);

    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByRole('alert')).toHaveTextContent('The password change result is unconfirmed. Try signing in with your new password first. If that fails, use password recovery.');
    expect(screen.queryByText(unconfirmedMessage)).not.toBeInTheDocument();

    act(() => useLocaleStore.getState().setLocale('zh-CN'));
    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmedMessage);
    expect(requests).toHaveLength(0);
  });

  it('does not render a query value as the recovery message or treat an arbitrary value as confirmation', async () => {
    window.history.replaceState(null, '', '/login?passwordChangeUnconfirmed=%3Cscript%3Esecret%3C%2Fscript%3E');
    render(<LoginPage />);
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret');
  });
});
