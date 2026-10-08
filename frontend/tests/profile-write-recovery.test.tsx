import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/profile/settings/page';
import api, { type ProfileInput } from '@/lib/api';
import { useAuthStore, type User } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/settings' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const customer: User = { user_id: 1, username: '旧名字', email: 'customer@example.test', phone: 'old phone', avatar_url: 'https://example.test/old.png' };
const second: User = { ...customer, user_id: 2, username: 'second', email: 'second@example.test' };
type ProfileResponse = { user: User & { password_hash?: string } };
const originalAdapter = api.defaults.adapter;

function failure(config: InternalAxiosRequestConfig, status?: number, message = '响应丢失') {
  return new AxiosError(message, status ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_NETWORK, config, undefined,
    status ? { config, data: { error: message }, status, statusText: 'Error', headers: {} } : undefined);
}

async function setup({ get = () => ({ user: customer }), put }: {
  get?: (config: InternalAxiosRequestConfig) => ProfileResponse | Promise<ProfileResponse>;
  put: (body: ProfileInput, config: InternalAxiosRequestConfig) => ProfileResponse | Promise<ProfileResponse>;
}) {
  const methods: string[] = [];
  useAuthStore.getState().login(customer, 'session-one');
  const adapter: AxiosAdapter = async config => {
    methods.push(config.method!);
    const data = config.method === 'get' ? await get(config) : await put(JSON.parse(config.data), config);
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  api.defaults.adapter = adapter;
  const view = render(<SettingsPage />);
  await settle();
  return { view, methods };
}

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const form = () => input('username').closest('form')!;
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const edit = (values: Record<string, string>) => {
  for (const [name, value] of Object.entries(values)) fireEvent.change(input(name), { target: { name, value } });
};
const submit = async () => { fireEvent.submit(form()); await settle(); };

afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('profile uncertain-write recovery through the real API client', () => {
  it.each([undefined, 408, 429, 500, 503])('reads canonical details after %s and recognizes an applied normalized save', async status => {
    let canonical: ProfileResponse = { user: customer };
    const { methods } = await setup({
      get: () => canonical,
      put: (body, config) => {
        canonical = { user: { ...customer, ...body, password_hash: 'private' } };
        throw failure(config, status);
      },
    });
    edit({ username: '  新名字  ', phone: '  ', avatar_url: '' });
    await submit();

    expect(methods).toEqual(['get', 'put', 'get']);
    expect(input('username')).toHaveValue('新名字');
    expect(input('phone')).toHaveValue('');
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
    expect(button('保存修改')).toBeDisabled();
    expect(button('撤销修改')).toBeDisabled();
    expect(useAuthStore.getState().user).toMatchObject({ username: '新名字', phone: null, avatar_url: null });
    expect(useAuthStore.getState().user).not.toHaveProperty('password_hash');
    act(() => useAuthStore.getState().hydrate());
    expect(useAuthStore.getState().user?.username).toBe('新名字');

    edit({ username: 'another draft' });
    fireEvent.click(button('撤销修改'));
    expect(input('username')).toHaveValue('新名字');
    expect(methods.filter(method => method === 'put')).toHaveLength(1);
  });

  it('preserves the raw draft when canonical details differ and lets Undo use the refreshed baseline', async () => {
    let reads = 0;
    const latest = { ...customer, username: '最新资料', phone: null };
    const { methods } = await setup({
      get: () => ({ user: ++reads === 1 ? customer : latest }),
      put: (_body, config) => { throw failure(config, 503); },
    });
    edit({ username: '  保留草稿  ', phone: '  ', avatar_url: '' });
    await submit();

    expect(methods).toEqual(['get', 'put', 'get']);
    expect(input('username')).toHaveValue('  保留草稿  ');
    expect(input('phone')).toHaveValue('  ');
    expect(useAuthStore.getState().user).toMatchObject(latest);
    expect(screen.queryByText('资料已保存')).not.toBeInTheDocument();
    expect(screen.getByText('当前资料与您的修改不同，已保留草稿，请检查后重试')).toBeInTheDocument();
    expect(button('保存修改')).toBeEnabled();

    fireEvent.click(button('撤销修改'));
    expect(input('username')).toHaveValue(latest.username);
    expect(input('phone')).toHaveValue('');
  });

  it('blocks stale Save and Undo until a read-only retry succeeds, keeping the draft across failed reads', async () => {
    let reads = 0;
    const latest = { ...customer, username: '草稿', phone: null, avatar_url: null };
    const { methods } = await setup({
      get: config => {
        if (++reads === 1) return { user: customer };
        if (reads < 4) throw failure(config);
        return { user: latest };
      },
      put: (_body, config) => { throw failure(config); },
    });
    edit({ username: '草稿', phone: '', avatar_url: '' });
    const staleSave = captureHandler(form(), 'onSubmit');
    const staleUndo = captureHandler(button('撤销修改'));
    await submit();

    expect(methods).toEqual(['get', 'put', 'get']);
    expect(input('username')).toHaveValue('草稿');
    expect(button('保存修改')).toBeDisabled();
    expect(button('撤销修改')).toBeDisabled();
    expect(screen.getByText('保存结果尚未确认，请重新加载资料后再操作')).toBeInTheDocument();
    await staleSave();
    await staleUndo();
    expect(input('username')).toHaveValue('草稿');
    expect(methods).toEqual(['get', 'put', 'get']);

    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByText('Your save is not yet confirmed. Reload your profile before making more changes.')).toBeInTheDocument();
    fireEvent.click(button('Reload profile'));
    await settle();
    expect(input('username')).toHaveValue('草稿');
    expect(button('Save changes')).toBeDisabled();
    await staleSave();
    await staleUndo();
    fireEvent.click(button('Reload profile'));
    await settle();

    expect(methods).toEqual(['get', 'put', 'get', 'get', 'get']);
    expect(screen.getByText('Profile saved')).toBeInTheDocument();
    expect(useAuthStore.getState().user).toMatchObject(latest);
  });

  it('keeps the mutation locked while its canonical read is pending', async () => {
    const pending = deferred<ProfileResponse>();
    let reads = 0;
    const { methods } = await setup({
      get: () => ++reads === 1 ? { user: customer } : pending.promise,
      put: (_body, config) => { throw failure(config, 429); },
    });
    edit({ username: 'pending' });
    const staleSave = captureHandler(form(), 'onSubmit');
    const staleUndo = captureHandler(button('撤销修改'));
    fireEvent.submit(form());
    await settle();

    expect(methods).toEqual(['get', 'put', 'get']);
    expect(button('保存中...')).toBeDisabled();
    expect(button('撤销修改')).toBeDisabled();
    await staleSave();
    await staleUndo();
    expect(input('username')).toHaveValue('pending');
    await act(async () => pending.resolve({ user: { ...customer, username: 'pending' } }));
    await settle();
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
    expect(methods.filter(method => method === 'put')).toHaveLength(1);
  });

  it.each(['invalid', 'storage'] as const)('stays blocked after a canonical %s failure and can recover by reading', async scenario => {
    let reads = 0;
    const latest = { ...customer, username: 'draft' };
    const { methods } = await setup({
      get: () => ({ user: ++reads === 2 && scenario === 'invalid' ? { ...second, username: 'private second' } : reads === 1 ? customer : latest }),
      put: (_body, config) => { throw failure(config); },
    });
    edit({ username: 'draft' });
    const staleSave = captureHandler(form(), 'onSubmit');
    const staleUndo = captureHandler(button('撤销修改'));
    const storage = scenario === 'storage' ? vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); }) : undefined;
    await submit();

    expect(methods).toEqual(['get', 'put', 'get']);
    expect(useAuthStore.getState().user?.username).toBe(customer.username);
    expect(document.body.textContent).not.toContain('private second');
    expect(button('保存修改')).toBeDisabled();
    expect(button('撤销修改')).toBeDisabled();
    await staleSave();
    await staleUndo();
    expect(input('username')).toHaveValue('draft');
    storage?.mockRestore();
    fireEvent.click(button('重新加载资料'));
    await settle();
    expect(methods).toEqual(['get', 'put', 'get', 'get']);
    expect(useAuthStore.getState().user?.username).toBe('draft');
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
  });

  it.each(['invalid', 'storage'] as const)('blocks stale mutations after a successful PUT with a %s sync problem', async scenario => {
    let reads = 0;
    const latest = { ...customer, username: 'draft' };
    const { methods } = await setup({
      get: () => ({ user: ++reads === 1 ? customer : latest }),
      put: () => ({ user: scenario === 'invalid' ? second : latest }),
    });
    edit({ username: 'draft' });
    const staleSave = captureHandler(form(), 'onSubmit');
    const staleUndo = captureHandler(button('撤销修改'));
    const storage = scenario === 'storage' ? vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); }) : undefined;
    await submit();

    expect(button('保存修改')).toBeDisabled();
    expect(button('撤销修改')).toBeDisabled();
    await staleSave();
    await staleUndo();
    expect(input('username')).toHaveValue('draft');
    expect(methods).toEqual(['get', 'put']);
    storage?.mockRestore();
    fireEvent.click(button('重新加载资料'));
    await settle();
    expect(methods).toEqual(['get', 'put', 'get']);
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
  });

  it('keeps a normal 400 rejection editable without a canonical read', async () => {
    const { methods } = await setup({ put: (_body, config) => { throw failure(config, 400, '用户名已被使用'); } });
    edit({ username: 'validation draft' });
    await submit();

    expect(methods).toEqual(['get', 'put']);
    expect(screen.getByText('用户名已被使用')).toBeInTheDocument();
    expect(input('username')).toHaveValue('validation draft');
    expect(button('保存修改')).toBeEnabled();
    fireEvent.click(button('撤销修改'));
    expect(input('username')).toHaveValue(customer.username);
  });

  it.each(['account', 'session', 'storage', 'storage_user', 'hydration', 'logout', 'unmount'] as const)('ignores a canonical read after a %s change', async scenario => {
    const pending = deferred<ProfileResponse>();
    let reads = 0;
    const { view, methods } = await setup({
      get: () => ++reads === 1 ? { user: customer } : reads === 2 ? pending.promise : { user: useAuthStore.getState().user! },
      put: (_body, config) => { throw failure(config); },
    });
    edit({ username: 'old draft' });
    const staleSave = captureHandler(form(), 'onSubmit');
    const staleUndo = captureHandler(button('撤销修改'));
    fireEvent.submit(form());
    await settle();
    expect(methods).toEqual(['get', 'put', 'get']);
    act(() => {
      if (scenario === 'account') useAuthStore.getState().login(second, 'session-two');
      if (scenario === 'session') useAuthStore.getState().login(customer, 'session-two');
      if (scenario === 'storage') localStorage.setItem('session', 'session-two');
      if (scenario === 'storage_user') localStorage.setItem('user', JSON.stringify(second));
      if (scenario === 'hydration') useAuthStore.setState({ isHydrated: false });
      if (scenario === 'logout') useAuthStore.getState().logout();
      if (scenario === 'unmount') view.unmount();
    });
    await settle();
    const before = useAuthStore.getState().user;
    const stored = localStorage.getItem('user');
    await act(async () => pending.resolve({ user: { ...customer, username: 'old draft' } }));
    await settle();
    await staleSave();
    await staleUndo();

    expect(useAuthStore.getState().user).toEqual(before);
    expect(localStorage.getItem('user')).toBe(stored);
    expect(methods.filter(method => method === 'put')).toHaveLength(1);
    expect(screen.queryByText('资料已保存')).not.toBeInTheDocument();
  });
});
