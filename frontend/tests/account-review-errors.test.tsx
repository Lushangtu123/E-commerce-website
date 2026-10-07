import { fireEvent } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from '@/app/register/page';
import api from '@/lib/api';
import { translate } from '@/lib/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { apiError, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const errors = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/register' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { errors.push(message); }, success: vi.fn() };
  return { default: toast, toast };
});

const originalAdapter = api.defaults.adapter;
let sent: { url?: string; body: Record<string, unknown> }[] = [];

/** Renders registration in `locale`; the real API client either signs the customer in or rejects with `rejectMessage`. */
async function setup({ locale = 'en', rejectMessage }: { locale?: Locale; rejectMessage?: string } = {}) {
  useLocaleStore.getState().setLocale(locale);
  useAuthStore.getState().hydrate();
  const adapter: AxiosAdapter = async config => {
    sent.push({ url: config.url, body: JSON.parse(config.data) });
    if (rejectMessage) throw apiError(rejectMessage);
    return { data: { user: { user_id: 1, username: 'Customer', email: 'customer@example.test' }, token: 'new-session' },
      status: 201, statusText: 'Created', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  render(<RegisterPage />);
  await settle();
}

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

async function register(fields: Record<string, string>) {
  for (const [name, value] of Object.entries(fields)) fireEvent.change(input(name), { target: { name, value } });
  fireEvent.submit(document.querySelector('form')!);
  await settle();
}

describe('registration errors', () => {
  beforeEach(() => {
    sent = [];
    errors.length = 0;
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('explains the UTF-8 password limit before sending a too-long multibyte password', async () => {
    const password = '汉'.repeat(25);
    expect(new TextEncoder().encode(password)).toHaveLength(75);
    await setup();

    await register({ username: 'Customer', email: 'customer@example.test', password, confirmPassword: password });

    expect(sent).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/72.*UTF-8|UTF-8.*72/);
    expect(errors[0]).not.toMatch(/[一-鿿]/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('trims account fields, accepts a one-character username and keeps password whitespace', async () => {
    const password = '  密码 password123 ';
    await setup();
    expect(input('username')).toHaveAttribute('maxlength', '50');
    expect(input('email')).toHaveAttribute('maxlength', '100');
    expect(input('password')).toHaveAttribute('minlength', '12');

    await register({ username: '  单  ', email: '  customer@example.test  ', password, confirmPassword: password });

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ username: '单', email: 'customer@example.test', password });
    expect(errors).toHaveLength(0);
    // The server's token stays in its httpOnly cookie; the page keeps only its own session id.
    const { sessionId } = useAuthStore.getState();
    expect(sessionId).toEqual(expect.any(String));
    expect(sessionId).not.toBe('new-session');
    expect(localStorage.getItem('session')).toBe(sessionId);
    expect(Object.values(localStorage).join()).not.toContain('new-session');
    expect(router.push.mock.calls).toEqual([['/']]);
  });

  it.each(['en', 'zh-CN'] as const)('shows the account validator failure in %s without signing in', async (locale) => {
    const message = '用户名必须为1至50个字符';
    await setup({ locale, rejectMessage: message });

    await register({ username: 'Customer', email: 'customer@example.test', password: 'valid-password', confirmPassword: 'valid-password' });

    expect(sent).toHaveLength(1);
    expect(errors[0]).toBe(locale === 'en' ? 'Username must contain 1 to 50 characters' : message);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
  it.each(['abc123', 'x'.repeat(11), ' '.repeat(12), '\u3000'.repeat(12), '\u0085'.repeat(12), ' \t\u0085\u3000'.repeat(3)])('registration rejects invalid new passwords before requests: %p', async password => {
    await setup();
    await register({ username: 'Customer', email: 'customer@example.test', password, confirmPassword: password });
    expect(sent).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

});

describe('error translations', () => {
  it.each([
    ['邮箱格式无效或超过100个字符', /email.*100/i],
    ['密码必须为字符串', /password.*string/i],
    ['注册字段或值无效', /registration.*fields/i],
    ['登录字段或值无效', /sign-in.*fields/i],
    ['个人资料字段或值无效', /profile.*fields/i],
    ['请至少提供一项个人资料修改', /at least one.*profile/i],
    ['联系电话必须为不超过20个字符的字符串或空值', /phone.*20/i],
    ['头像地址必须为不超过255个字符的HTTP(S)网址或空值', /avatar.*255.*HTTP/i],
    ['用户名或邮箱已被使用', /username.*email.*already/i],
  ])('translates the account message "%s" exactly', (message, expected) => {
    expect(translate(message, {}, 'en')).toMatch(expected);
    expect(translate(message, {}, 'en')).not.toMatch(/[一-鿿]/);
    expect(translate(message, {}, 'zh-CN')).toBe(message);
  });

  it('leaves unknown content containing a known message literal', () => {
    const original = '原始商品名：邮箱格式无效或超过100个字符 $& {count}';
    expect(translate(original, {}, 'en')).toBe(original);
  });

  it.each([
    ['评论参数或字段无效', /invalid.*review/i],
    ['用户或商品或订单ID无效', /invalid.*user.*product.*order/i],
    ['该商品不属于此订单', /product.*not.*order/i],
    ['评论已存在，请勿重复提交', /review.*already.*resubmit/i],
  ])('translates the review message "%s" in the selected language', (message, expected) => {
    expect(translate(message, {}, 'en')).toMatch(expected);
    expect(translate(message, {}, 'zh-CN')).toBe(message);
  });

  it('leaves review content that merely contains a known message literal', () => {
    const content = '我的评论已存在，请勿重复提交？这个商品不错。';
    expect(translate(content, {}, 'en')).toBe(content);
  });
});
