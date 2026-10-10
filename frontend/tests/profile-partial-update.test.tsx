import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/profile/settings/page';
import api, { type ProfileInput } from '@/lib/api';
import { useAuthStore, type User } from '@/store/useAuthStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/settings' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const customer: User = { user_id: 1, username: 'original', email: 'customer@example.test', phone: 'old phone', avatar_url: 'https://example.test/old.png' };
const originalAdapter = api.defaults.adapter;
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const form = () => input('username').closest('form')!;
const edit = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const submit = async () => { fireEvent.submit(form()); await settle(); };

async function setup(initial = customer, mutate?: (current: User, patch: ProfileInput) => { user: User; lostResponse?: boolean }) {
  let canonical = { ...initial };
  const writes: ProfileInput[] = [];
  const methods: string[] = [];
  useAuthStore.getState().login(initial, 'session-one');
  const adapter: AxiosAdapter = async config => {
    methods.push(config.method!);
    if (config.method === 'put') {
      const patch = JSON.parse(config.data) as ProfileInput;
      writes.push(patch);
      const result = mutate?.(canonical, patch) ?? { user: { ...canonical, ...patch } };
      canonical = result.user;
      if (result.lostResponse) throw new Error('response lost');
    }
    return { config, data: { user: { ...canonical } }, status: 200, statusText: 'OK', headers: {} };
  };
  api.defaults.adapter = adapter;
  render(<SettingsPage />);
  await settle();
  return { writes, methods, current: () => canonical, replace: (user: User) => { canonical = user; } };
}

afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('profile field changes through the real API client', () => {
  it.each([
    ['username', '  chosen username  ', { username: 'chosen username' }],
    ['phone', '  ', { phone: null }],
    ['avatar_url', '', { avatar_url: null }],
  ] as const)('writes only the edited %s and preserves other fields changed in another tab', async (field, value, patch) => {
    const server = await setup();
    edit(field, value);
    const concurrent = { ...customer, username: 'other tab name', phone: 'other tab phone', avatar_url: 'https://example.test/other.png' };
    server.replace(concurrent);

    await submit();

    expect(server.writes).toEqual([patch]);
    expect(server.current()).toEqual({ ...concurrent, ...patch });
    expect(useAuthStore.getState().user).toEqual(server.current());
  });

  it('does not send a write for changes that only add surrounding whitespace', async () => {
    const server = await setup();
    for (const field of ['username', 'phone', 'avatar_url'] as const) edit(field, `  ${customer[field]}  `);

    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '撤销修改' })).toBeEnabled();
    await submit();
    expect(server.methods).toEqual(['get']);
    fireEvent.click(screen.getByRole('button', { name: '撤销修改' }));
    expect(input('username')).toHaveValue(customer.username);
  });

  it('normalizes the loaded baseline as well as the draft before selecting changed fields', async () => {
    const server = await setup({ ...customer, phone: '  old phone  ', avatar_url: `  ${customer.avatar_url}  ` });
    edit('username', 'chosen username');
    edit('phone', 'old phone');
    edit('avatar_url', customer.avatar_url!);
    await submit();

    expect(server.writes).toEqual([{ username: 'chosen username' }]);
  });

  it('recognizes a lost username response despite later unrelated changes and adopts their current values', async () => {
    const server = await setup(customer, (current, patch) => ({
      user: { ...current, ...patch, phone: 'independent phone', avatar_url: 'https://example.test/independent.png' }, lostResponse: true,
    }));
    edit('username', '  chosen username  ');
    await submit();

    expect(server.writes).toEqual([{ username: 'chosen username' }]);
    expect(server.methods).toEqual(['get', 'put', 'get']);
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
    expect(input('username')).toHaveValue('chosen username');
    expect(input('phone')).toHaveValue('independent phone');
    expect(input('avatar_url')).toHaveValue('https://example.test/independent.png');
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    act(() => useAuthStore.getState().hydrate());
    expect(useAuthStore.getState().user).toEqual(server.current());
  });

  it('keeps the raw edited field after an unapplied write and uses fresh untouched fields for the retry', async () => {
    let attempts = 0;
    const server = await setup(customer, (current, patch) => ++attempts === 1 ? {
      user: { ...current, username: 'independent name', phone: 'independent phone', avatar_url: 'https://example.test/independent.png' }, lostResponse: true,
    } : { user: { ...current, ...patch } });
    edit('username', '  retained draft  ');
    await submit();

    expect(screen.queryByText('资料已保存')).not.toBeInTheDocument();
    expect(screen.getByText('当前资料与您的修改不同，已保留草稿，请检查后重试')).toBeInTheDocument();
    expect(input('username')).toHaveValue('  retained draft  ');
    expect(input('phone')).toHaveValue('independent phone');
    expect(input('avatar_url')).toHaveValue('https://example.test/independent.png');
    await submit();

    expect(server.writes).toEqual([{ username: 'retained draft' }, { username: 'retained draft' }]);
    expect(server.current()).toMatchObject({ username: 'retained draft', phone: 'independent phone', avatar_url: 'https://example.test/independent.png' });
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
  });

  it.each(['phone', 'avatar_url'] as const)('confirms an explicit %s clear without requiring untouched fields to match', async field => {
    const server = await setup(customer, (current, patch) => ({ user: { ...current, ...patch, username: 'independent name' }, lostResponse: true }));
    edit(field, '  ');
    await submit();

    expect(server.writes).toEqual([{ [field]: null }]);
    expect(server.methods).toEqual(['get', 'put', 'get']);
    expect(input(field)).toHaveValue('');
    expect(input('username')).toHaveValue('independent name');
    expect(screen.getByText('资料已保存')).toBeInTheDocument();
  });
});
