import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from '@/app/reset-password/page';
import api from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle, submitTogether } from './helpers';

const token = 'a'.repeat(64);
const password = ' new reset password 123 ';
const acknowledgement = { message: '密码已重置，请重新登录', reauthenticate: true };
const unknownMessage = '重置密码结果尚未确认，请先尝试用新密码登录；若无法登录，请重新申请重置邮件';
const englishUnknown = 'The password reset result is unconfirmed. Try signing in with your new password first. If that fails, request a new reset email.';
const customer = { user_id: 1, username: 'Customer', email: 'customer@example.test' };
const replacement = { user_id: 2, username: 'Replacement', email: 'replacement@example.test' };
const originalAdapter = api.defaults.adapter;
let requests: InternalAxiosRequestConfig[];

type Handler = (body: { token: string; newPassword: string }, config: InternalAxiosRequestConfig) => unknown;
async function setup(handler: Handler = () => acknowledgement) {
  const adapter: AxiosAdapter = async config => {
    requests.push(config);
    expect(`${config.method} ${config.url}`).toBe('post /users/password/reset');
    return { data: await handler(JSON.parse(config.data), config), status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  window.history.replaceState(null, '', `/reset-password#token=${token}`);
  const view = render(<StrictMode><ResetPasswordPage /></StrictMode>);
  await settle();
  for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) fireEvent.change(input, { target: { value: password } });
  return { ...view, form: document.querySelector('form')! };
}

function rejected(status: number | undefined, config: InternalAxiosRequestConfig, error = '服务暂不可用', code?: string) {
  return Object.assign(new Error('Request failed'), { config, ...(status ? { response: { config, status, data: { error, code } } } : {}) });
}

function expectRecovery() {
  expect(screen.getByRole('alert')).toHaveTextContent(unknownMessage);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(document.querySelector('form')).toBeNull();
  expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('link', { name: '重新申请重置邮件' })).toHaveAttribute('href', '/forgot-password');
  expect(document.body.textContent).not.toContain(token);
  expect(localStorage.getItem('token')).toBeNull();
  expect(sessionStorage.length).toBe(0);
}

beforeEach(() => { requests = []; });
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('password reset receipt and uncertain outcome recovery', () => {
  it('forgets the original session only after the explicit backend receipt and never repeats the one-time token', async () => {
    useAuthStore.getState().login(customer, 'session-a');
    const pending = deferred();
    const { form } = await setup(() => pending.promise);
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    submitTogether(form, form);
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0].data)).toEqual({ token, newPassword: password });
    expect(requests[0].headers.get('Authorization')).toBeFalsy();
    expect(useAuthStore.getState().sessionId).toBe('session-a');
    await act(async () => pending.resolve(acknowledgement));
    await settle();

    expect(screen.getByRole('status')).toHaveTextContent('密码已重置，所有旧会话已失效');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('session')).toBeNull();
    await obsoleteSubmit();
    expect(requests).toHaveLength(1);
  });

  it.each([{}, null, false, 'success', { reauthenticate: false }, { reauthenticate: 'true' }])('does not claim success for a malformed receipt %j', async body => {
    const { form } = await setup(() => body);
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    fireEvent.submit(form);
    await settle();

    expectRecovery();
    await obsoleteSubmit();
    expect(requests).toHaveLength(1);
  });

  it('does not resend a consumed token after the server commits but loses its reply', async () => {
    let committedPassword = '', consumed = false;
    const { form } = await setup((body, config) => {
      if (consumed) throw rejected(400, config, '密码重置链接无效或已过期', 'INVALID_RESET_TOKEN');
      consumed = true;
      committedPassword = body.newPassword;
      throw rejected(undefined, config);
    });
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    fireEvent.submit(form);
    await settle();

    expect(committedPassword).toBe(password);
    expectRecovery();
    await obsoleteSubmit();
    expect(requests).toHaveLength(1);
    expect(screen.getByRole('alert')).not.toHaveTextContent('已过期');
  });

  it.each([undefined, 408, 409, 429, 500, 503])('clears drafts and prevents retries when the write result is unknown (status %s)', async status => {
    useAuthStore.getState().login(customer, 'session-a');
    const { form } = await setup((_, config) => { throw rejected(status, config); });
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    fireEvent.submit(form);
    await settle();

    expectRecovery();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await obsoleteSubmit();
    expect(requests).toHaveLength(1);
  });

  it.each([400, 403])('keeps a definite form rejection editable (status %s)', async status => {
    const error = '密码必须至少12个字符';
    const { form } = await setup((_, config) => {
      if (requests.length === 1) throw rejected(status, config, error);
      return acknowledgement;
    });
    fireEvent.submit(form);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(error);
    for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) expect(input).toHaveValue(password);
    expect(screen.getByRole('button', { name: '设置新密码' })).toBeEnabled();
    fireEvent.submit(form);
    await settle();
    expect(requests).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('密码已重置');
  });

  it('discards an invalid token and its drafts without letting an obsolete handler retry', async () => {
    const { form } = await setup((_, config) => { throw rejected(400, config, '密码重置链接无效或已过期', 'INVALID_RESET_TOKEN'); });
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    fireEvent.submit(form);
    await settle();

    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('密码重置链接无效或已过期');
    expect(screen.getByRole('link', { name: '重新申请重置邮件' })).toBeInTheDocument();
    await obsoleteSubmit();
    expect(requests).toHaveLength(1);
  });

  it.each(['confirmed', 'unknown'] as const)('preserves a replacement session after a late %s result', async outcome => {
    useAuthStore.getState().login(customer, 'session-a');
    const pending = deferred();
    const { form } = await setup(() => pending.promise);
    fireEvent.submit(form);
    act(() => useAuthStore.getState().login(replacement, 'session-b'));
    await act(async () => outcome === 'confirmed' ? pending.resolve(acknowledgement) : pending.reject(new Error('Lost committed reply')));
    await settle();

    expect(useAuthStore.getState().sessionId).toBe('session-b');
    expect(localStorage.getItem('session')).toBe('session-b');
    expect(useAuthStore.getState().user?.user_id).toBe(2);
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it.each(['confirmed', 'unknown'] as const)('keeps a cross-tab replacement when this tab still shows the old session (%s)', async outcome => {
    useAuthStore.getState().login(customer, 'session-a');
    const pending = deferred();
    const { form } = await setup(() => pending.promise);
    fireEvent.submit(form);
    localStorage.setItem('session', 'session-b');
    localStorage.setItem('user', JSON.stringify(replacement));
    await act(async () => outcome === 'confirmed' ? pending.resolve(acknowledgement) : pending.reject(new Error('Lost committed reply')));
    await settle();

    expect(localStorage.getItem('session')).toBe('session-b');
    expect(JSON.parse(localStorage.getItem('user')!).user_id).toBe(2);
  });

  it.each(['confirmed', 'unknown'] as const)('keeps its %s result when storage becomes unavailable without signing out an unverifiable session', async outcome => {
    useAuthStore.getState().login(customer, 'session-a');
    const pending = deferred();
    const { form } = await setup(() => pending.promise);
    fireEvent.submit(form);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError'); });
    await act(async () => outcome === 'confirmed' ? pending.resolve(acknowledgement) : pending.reject(new Error('Lost committed reply')));
    await settle();

    expect(useAuthStore.getState().sessionId).toBe('session-a');
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    if (outcome === 'confirmed') expect(screen.getByRole('status')).toHaveTextContent('密码已重置');
    else expect(screen.getByRole('alert')).toHaveTextContent(unknownMessage);
  });

  it('switches the uncertainty guidance between Chinese and English without submitting again', async () => {
    const { form } = await setup((_, config) => { throw rejected(undefined, config); });
    fireEvent.submit(form);
    await settle();

    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByRole('alert')).toHaveTextContent(englishUnknown);
    act(() => useLocaleStore.getState().setLocale('zh-CN'));
    expect(screen.getByRole('alert')).toHaveTextContent(unknownMessage);
    expect(requests).toHaveLength(1);
  });

  it('cannot publish or submit from an unmounted page when its result arrives late', async () => {
    const pending = deferred();
    const { form, unmount } = await setup(() => pending.promise);
    const obsoleteSubmit = captureHandler(form, 'onSubmit');
    fireEvent.submit(form);
    unmount();
    await act(async () => pending.resolve(acknowledgement));
    await settle();
    await obsoleteSubmit();

    expect(requests).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
