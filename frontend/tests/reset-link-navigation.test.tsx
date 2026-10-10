import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ResetPasswordPage from '@/app/reset-password/page';
import api from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const first = 'a'.repeat(64), second = 'b'.repeat(64), third = 'c'.repeat(64);
const password = 'new reset password 123';
const receipt = { reauthenticate: true };
const originalAdapter = api.defaults.adapter;
let requests: InternalAxiosRequestConfig[];
let pendingReplies: ReturnType<typeof deferred>[];
type Handler = (body: { token: string; newPassword: string }, config: InternalAxiosRequestConfig) => unknown;

async function setup(hash = `#token=${first}`, handler: Handler = () => receipt) {
  const adapter: AxiosAdapter = async config => {
    requests.push(config);
    expect(`${config.method} ${config.url}`).toBe('post /users/password/reset');
    return { data: await handler(JSON.parse(config.data), config), status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  window.history.replaceState({ nextRouter: 'preserved' }, '', `/reset-password?source=email${hash}`);
  const view = render(<StrictMode><ResetPasswordPage /></StrictMode>);
  await settle();
  return view;
}
const fill = () => {
  for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) fireEvent.change(input, { target: { value: password } });
};
async function navigate(hash: string) {
  act(() => { window.location.hash = hash; });
  await settle();
}
async function submit() {
  fireEvent.submit(document.querySelector('form')!);
  await settle();
}
function failure(status: number | undefined, config: InternalAxiosRequestConfig, error = '服务暂不可用', code?: string) {
  return Object.assign(new Error('Request failed'), { config, ...(status ? { response: { config, status, data: { error, code } } } : {}) });
}
beforeEach(() => { requests = []; pendingReplies = []; });
afterEach(async () => {
  pendingReplies.forEach(pending => pending.resolve(receipt));
  await settle();
  api.defaults.adapter = originalAdapter;
});

describe('new reset capabilities on a still-open page', () => {
  it('fresh-mount control survives Strict Mode and strips the token while retaining Next history state and query', async () => {
    await setup(`#token=${second}`);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?source=email');
    expect(window.history.state).toEqual({ nextRouter: 'preserved' });
    fill(); await submit();
    expect(requests.map(request => JSON.parse(request.data))).toEqual([{ token: second, newPassword: password }]);
  });

  it.each(['zh-CN', 'en'] as const)('accepts a new link in an initially invalid reset tab (%s)', async locale => {
    await setup('');
    act(() => useLocaleStore.getState().setLocale(locale));
    expect(document.querySelector('form')).toBeNull();
    await navigate(`token=${second}`);
    expect(document.querySelector('form')).not.toBeNull();
    expect(window.location.hash).toBe('');
    expect(requests).toHaveLength(0);
    fill(); await submit();
    expect(JSON.parse(requests[0].data).token).toBe(second);
  });

  it('clears old drafts and submits the new capability after replacing an unused link', async () => {
    await setup(); fill();
    await navigate(`token=${second}`);
    for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) expect(input).toHaveValue('');
    expect(window.location.hash).toBe('');
    expect(requests).toHaveLength(0);
    fill(); await submit();
    expect(JSON.parse(requests[0].data).token).toBe(second);
  });

  it('retires a captured old form handler when the link changes', async () => {
    await setup(); fill();
    const oldSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    await navigate(`token=${second}`);
    await oldSubmit(); await settle();
    expect(requests).toHaveLength(0);
    fill(); await submit();
    expect(JSON.parse(requests[0].data).token).toBe(second);
  });

  it('blocks a stale form before the browser delivers hashchange', async () => {
    await setup(); fill();
    const oldSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    act(() => { window.history.pushState(window.history.state, '', `/reset-password?source=email#token=${second}`); });
    await oldSubmit(); await settle();
    expect(requests).toHaveLength(0);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    await settle();
    expect(window.location.hash).toBe('');
    fill(); await submit();
    expect(JSON.parse(requests[0].data).token).toBe(second);
  });

  it('does not reset an unused form for a duplicate fragment or a hashless history event', async () => {
    await setup(); fill();
    await navigate(`token=${first}`);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    await settle();
    for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) expect(input).toHaveValue(password);
    expect(window.location.hash).toBe('');
    expect(requests).toHaveLength(0);
  });

  it.each(['token=short', `token=${second}&extra=1`, 'unrelated'])('retires the old link and strips an invalid replacement #%s', async hash => {
    await setup(); fill();
    const oldSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    await navigate(hash);
    expect(window.location.hash).toBe('');
    expect(document.querySelector('form')).toBeNull();
    await oldSubmit(); await settle();
    expect(requests).toHaveLength(0);
    await navigate(`token=${second}`);
    expect(document.querySelector('form')).not.toBeNull();
  });

  it.each(['confirmed', 'unknown', 'invalid'] as const)('never reuses a %s capability even after another link', async outcome => {
    await setup(undefined, (_, config) => {
      if (outcome === 'unknown') throw failure(undefined, config);
      if (outcome === 'invalid') throw failure(400, config, '密码重置链接无效或已过期', 'INVALID_RESET_TOKEN');
      return receipt;
    });
    fill(); await submit();
    expect(requests).toHaveLength(1);
    expect(document.querySelector('form')).toBeNull();
    const notice = document.body.textContent;
    await navigate(`token=${first}`);
    expect(document.body.textContent).toBe(notice);
    expect(document.querySelector('form')).toBeNull();
    await navigate(`token=${second}`);
    expect(document.querySelector('form')).not.toBeNull();
    await navigate(`token=${first}`);
    expect(document.querySelector('form')).toBeNull();
    expect(requests).toHaveLength(1);
    expect(window.location.hash).toBe('');
  });

  it.each(['confirmed', 'unknown', 'invalid', 'validation'] as const)('keeps a replacement link locked until an older %s request settles, then preserves the new form', async outcome => {
    const pending = deferred();
    pendingReplies.push(pending);
    let firstConfig: InternalAxiosRequestConfig | undefined;
    await setup(undefined, (body, config) => {
      if (body.token === first) { firstConfig = config; return pending.promise; }
      return receipt;
    });
    fill(); await submit();
    expect(requests).toHaveLength(1);
    await navigate(`token=${second}`);
    expect(window.location.hash).toBe('');
    expect(document.querySelector('form')).not.toBeNull();
    for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) {
      expect(input).toHaveValue(''); expect(input).toBeDisabled();
    }
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(requests).toHaveLength(1);
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'replacement', email: 'replacement@example.test' }, 'session-b'));
    await act(async () => {
      if (outcome === 'confirmed') pending.resolve(receipt);
      else if (outcome === 'unknown') pending.reject(failure(undefined, firstConfig!));
      else if (outcome === 'invalid') pending.reject(failure(400, firstConfig!, '密码重置链接无效或已过期', 'INVALID_RESET_TOKEN'));
      else pending.reject(failure(400, firstConfig!, '密码必须至少12个字符'));
    });
    await settle();
    expect(useAuthStore.getState().sessionId).toBe('session-b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const input of Array.from(document.querySelectorAll('input[type="password"]'))) expect(input).toBeEnabled();
    fill(); await submit();
    expect(requests.map(request => JSON.parse(request.data).token)).toEqual([first, second]);
  });

  it('does not restore an old consumed token after its late response arrives under a newer link', async () => {
    const pending = deferred();
    pendingReplies.push(pending);
    await setup(undefined, () => pending.promise); fill(); await submit();
    await navigate(`token=${second}`);
    await act(async () => pending.resolve(receipt)); await settle();
    await navigate(`token=${first}`);
    expect(document.querySelector('form')).toBeNull();
    await navigate(`token=${third}`);
    expect(document.querySelector('form')).not.toBeNull();
    expect(requests).toHaveLength(1);
  });

  it.each(['confirmed', 'unknown'] as const)('never republishes a dispatched capability when returning to its link before a late %s reply', async outcome => {
    const pending = deferred(); pendingReplies.push(pending);
    let config: InternalAxiosRequestConfig | undefined;
    await setup(undefined, (_, request) => { config = request; return pending.promise; });
    fill();
    const oldSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    await submit();
    await navigate(`token=${second}`);
    await navigate(`token=${first}`);
    expect(window.location.hash).toBe('');
    expect(document.querySelector('form')).toBeNull();
    await act(async () => outcome === 'confirmed' ? pending.resolve(receipt) : pending.reject(failure(undefined, config!)));
    await settle();
    expect(document.querySelector('form')).toBeNull();
    await oldSubmit(); await settle();
    await navigate(`token=${first}`);
    expect(document.querySelector('form')).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('permits an explicit corrected retry after a definite field rejection proves the dispatched capability unused', async () => {
    const pending = deferred(); pendingReplies.push(pending);
    let config: InternalAxiosRequestConfig | undefined;
    await setup(undefined, (_, request) => { config = request; return requests.length === 1 ? pending.promise : receipt; });
    fill(); await submit();
    await navigate(`token=${second}`);
    await navigate(`token=${first}`);
    expect(document.querySelector('form')).toBeNull();
    await act(async () => pending.reject(failure(400, config!, '密码必须至少12个字符'))); await settle();
    await navigate(`token=${first}`);
    expect(document.querySelector('form')).not.toBeNull();
    fill(); await submit();
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].data).token).toBe(first);
  });
});
