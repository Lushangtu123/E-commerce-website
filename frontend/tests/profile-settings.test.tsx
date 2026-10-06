import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/profile/page';
import SettingsPage from '@/app/profile/settings/page';
import api from '@/lib/api';
import { useAuthStore, type User } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { CommitLog, apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/settings' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

type Request = { method?: string; url?: string; body?: Record<string, unknown>; authorization: unknown };
/** The server may echo private columns such as password_hash; the client must drop them. */
type ProfileResponse = { user: User & { password_hash?: string } };

const customer: User = { user_id: 1, username: '旧名字', email: 'customer@example.test', phone: 'old phone', avatar_url: 'https://example.test/old.png' };
const second: User = { ...customer, user_id: 2, username: 'second', email: 'second@example.test' };
const cartItem: CartItem = { cart_id: 1, product_id: 1, title: 'Item', quantity: 2, price: 10, stock: 5 };
const zeroStats = { totalOrders: 0, pendingOrders: 0, totalCoupons: 0, availableCoupons: 0, favoriteCount: 0 };
const originalAdapter = api.defaults.adapter;
let requests: Request[] = [];

describe('auth store profile updates', () => {
  it('survive rehydration without clearing the cart or accepting private account fields', () => {
    useAuthStore.getState().login(customer, 'session-one');
    useCartStore.getState().setItems([cartItem]);

    useAuthStore.getState().updateUser({ username: '新名字', phone: null, avatar_url: null, password_hash: 'private' } as Partial<User>, 'session-one');
    expect(JSON.parse(localStorage.getItem('user')!).username).toBe('新名字');
    useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().user).toMatchObject({ username: '新名字', phone: null });
    expect(useAuthStore.getState().user).not.toHaveProperty('password_hash');
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(localStorage.getItem('token')).toBe('session-one');
  });

  it.each(['account', 'token', 'storage', 'storage_user'] as const)('cannot replace the user after a %s change', (scenario) => {
    useAuthStore.getState().login(customer, 'session-one');
    if (scenario === 'account') useAuthStore.getState().login({ ...customer, user_id: 2, username: 'another' }, 'session-two');
    if (scenario === 'token') useAuthStore.getState().login(customer, 'session-two');
    if (scenario === 'storage') localStorage.setItem('token', 'session-two');
    if (scenario === 'storage_user') localStorage.setItem('user', JSON.stringify({ ...customer, user_id: 2 }));
    const before = useAuthStore.getState().user;
    const stored = localStorage.getItem('user');

    useAuthStore.getState().updateUser({ ...customer, username: 'late update' }, 'session-one');

    expect(useAuthStore.getState().user).toEqual(before);
    expect(localStorage.getItem('user')).toBe(stored);
  });

  it('refuses an update it cannot persist, so a refresh cannot undo it', () => {
    useAuthStore.getState().login(customer, 'session-one');
    const before = useAuthStore.getState().user;
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); });

    expect(useAuthStore.getState().updateUser({ username: 'unpersisted' }, 'session-one')).toBe(false);
    expect(useAuthStore.getState().user).toEqual(before);
  });
});

/** Answers the real API client: GET /users/profile, PUT /users/profile and the profile page's stats. */
function serve({ getProfile = async () => ({ user: customer }), save = async body => ({ user: { ...customer, ...(body as Partial<User>) } }) }: {
  getProfile?: (config: InternalAxiosRequestConfig) => Promise<ProfileResponse> | ProfileResponse;
  save?: (body: Record<string, unknown>) => Promise<ProfileResponse>;
} = {}) {
  const adapter: AxiosAdapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    if (config.url === '/users/stats') return { data: { stats: zeroStats }, status: 200, statusText: 'OK', headers: {}, config };
    requests.push({ method: config.method, body, authorization: config.headers.get('Authorization'), url: config.url });
    const data = config.method === 'get' ? await getProfile(config) : await save(body);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

function signIn() {
  localStorage.setItem('token', 'session-one');
  localStorage.setItem('user', JSON.stringify(customer));
  localStorage.setItem('admin_token', 'administrator');
  useAuthStore.getState().hydrate();
}

async function show(page: ReactNode) {
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}>{page}</CommitLog>);
  await settle();
  return { view, commits };
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('profile page account details', () => {
  it('links to editing account details', async () => {
    useAuthStore.getState().login(customer, 'session-one');
    serve();
    await show(<ProfilePage />);

    expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/profile/settings')).toHaveLength(1);
  });

  it('shows the saved avatar and falls back to a default icon when the URL fails', async () => {
    useAuthStore.getState().login(customer, 'session-one');
    serve();
    await show(<ProfilePage />);

    const avatar = screen.getByRole('img', { name: '用户头像' });
    expect(avatar).toHaveAttribute('src', customer.avatar_url);
    expect(screen.getByText(customer.phone!)).toBeInTheDocument();

    fireEvent.error(avatar);
    expect(document.querySelector(`img[src="${customer.avatar_url}"]`)).toBeNull();

    act(() => { useAuthStore.getState().updateUser({ avatar_url: 'https://example.test/new.png' }, 'session-one'); });
    expect(document.querySelectorAll('img[src="https://example.test/new.png"]')).toHaveLength(1);
  });
});

describe('settings page', () => {
  async function setup({ locale = 'zh-CN' as Locale, ...routes }: Parameters<typeof serve>[0] & { locale?: Locale } = {}) {
    signIn();
    useLocaleStore.getState().setLocale(locale);
    serve(routes);
    return show(<SettingsPage />);
  }

  const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  // The password section below has its own form; this is the profile one.
  const profileForm = () => input('username')?.closest('form') ?? null;
  const button = (name: string) => screen.queryAllByRole<HTMLButtonElement>('button', { name })[0];
  const puts = () => requests.filter(request => request.method === 'put');

  function edit(values: Record<string, string>) {
    for (const [name, value] of Object.entries(values)) fireEvent.change(input(name), { target: { value, name } });
  }

  async function submit() {
    fireEvent.submit(profileForm()!);
    await settle();
  }

  it('loads the current server details and keeps the email read-only', async () => {
    await setup({ getProfile: async () => ({ user: { ...customer, username: '服务器资料', phone: null } }) });

    expect(input('username')).toHaveValue('服务器资料');
    expect(input('phone')).toHaveValue('');
    expect(input('email')).toHaveAttribute('readonly');
    expect(input('email')).toHaveValue(customer.email);
    expect(input('username')).toHaveAttribute('maxlength', '50');
    expect(input('phone')).toHaveAttribute('maxlength', '20');
    expect(input('avatar_url')).toHaveAttribute('maxlength', '255');
    expect(button('保存修改')).toBeDisabled();
    expect(useAuthStore.getState().user?.username).toBe('服务器资料');

    await submit();
    expect(requests.map(request => request.method)).toEqual(['get']);
  });

  it('saves only permitted normalized fields and clears phone and avatar across a refresh', async () => {
    await setup({ save: async body => ({ user: { ...customer, ...(body as Partial<User>), username: '服务器确认名', password_hash: 'private' } }) });
    useCartStore.getState().setItems([cartItem]);

    edit({ username: '  新名字  ', phone: '  ', avatar_url: '' });
    await submit();

    expect(requests[1]).toEqual({ method: 'put', body: { username: '新名字', phone: null, avatar_url: null }, authorization: 'Bearer session-one', url: '/users/profile' });
    expect(input('username')).toHaveValue('服务器确认名');
    expect(screen.getByText(/资料已保存/)).toBeInTheDocument();
    useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().user).toMatchObject({ username: '服务器确认名', phone: null });
    expect(useAuthStore.getState().user).not.toHaveProperty('password_hash');
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(localStorage.getItem('admin_token')).toBe('administrator');
  });

  it('retries a failed load and keeps drafts for correction after a server conflict', async () => {
    let attempts = 0;
    await setup({
      getProfile: async () => { if (++attempts === 1) throw new Error('offline'); return { user: customer }; },
      save: async () => { throw apiError('用户名已被使用'); },
    });
    expect(screen.getByText(/加载个人资料失败/)).toBeInTheDocument();
    expect(profileForm()).toBeNull();

    fireEvent.click(button('重新加载资料'));
    await settle();
    edit({ username: '保留修改' });
    await submit();
    expect(input('username')).toHaveValue('保留修改');
    expect(screen.getByText(/用户名已被使用/)).toBeInTheDocument();

    fireEvent.click(button('撤销修改'));
    await settle();
    expect(input('username')).toHaveValue(customer.username);
    expect(button('保存修改')).toBeDisabled();
  });

  it('blocks repeated submits and disables the editable fields while saving', async () => {
    const pending = deferred<ProfileResponse>();
    await setup({ save: () => pending.promise });
    edit({ username: 'new' });

    submitTogether(profileForm()!, profileForm()!);
    await settle();

    expect(puts()).toHaveLength(1);
    for (const name of ['username', 'phone', 'avatar_url']) expect(input(name)).toBeDisabled();
    expect(button('保存中...')).toBeDisabled();
    await act(async () => pending.resolve({ user: { ...customer, username: 'new' } }));
    await settle();
    expect(screen.getByText(/资料已保存/)).toBeInTheDocument();
  });

  it('follows language changes for labels and async errors without translating user content', async () => {
    const pending = deferred<ProfileResponse>();
    await setup({ locale: 'en', save: () => pending.promise });
    expect(screen.getByText('Edit profile')).toBeInTheDocument();
    expect(input('username')).toHaveValue(customer.username);

    edit({ username: '我的名字' });
    fireEvent.submit(profileForm()!);
    act(() => useLocaleStore.getState().setLocale('zh-CN'));
    await act(async () => pending.reject(apiError('用户名已被使用')));
    await settle();
    expect(screen.getByText(/用户名已被使用/)).toBeInTheDocument();

    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByText(/This username is already taken/)).toBeInTheDocument();
    expect(input('username')).toHaveValue('我的名字');
  });

  it.each([
    ['username', '  ', '用户名必须'], ['username', 'x'.repeat(51), '用户名必须'],
    ['phone', 'x'.repeat(21), '联系电话必须'],
    ['avatar_url', '/image.png', '头像地址必须'], ['avatar_url', 'javascript:alert(1)', '头像地址必须'],
    ['avatar_url', 'ftp://example.test/photo.png', '头像地址必须'], ['avatar_url', 'https://example.test/a b', '头像地址必须'],
    ['avatar_url', 'https://example.test/' + 'x'.repeat(255), '头像地址必须'],
  ])('keeps an invalid %s (%#) from the API and available for correction', async (name, value, message) => {
    await setup();

    edit({ [name]: value });
    await submit();

    expect(puts()).toHaveLength(0);
    expect(document.body.textContent).toContain(message);
    expect(input(name)).toHaveValue(value);
  });

  it('accepts values at every field limit', async () => {
    await setup();
    const prefix = 'https://example.test/';

    edit({ username: '单', phone: 'a'.repeat(20), avatar_url: prefix + 'a'.repeat(255 - prefix.length) });
    await submit();

    expect(String(requests[1].body?.avatar_url)).toHaveLength(255);
    expect(screen.getByText(/资料已保存/)).toBeInTheDocument();
  });

  it('requests nothing before hydration or when signed out', async () => {
    signIn();
    useAuthStore.setState({ isHydrated: false });
    serve();
    await show(<SettingsPage />);
    expect(requests).toEqual([]);

    act(() => useAuthStore.getState().logout());
    await settle();

    expect(requests).toEqual([]);
    expect(router.push.mock.calls).toEqual([['/login']]);
  });

  it.each(['success', 'failure'] as const)("never reveals another customer's details from a previous load %s", async (outcome) => {
    const pending = deferred<ProfileResponse>();
    let attempts = 0;
    const { commits } = await setup({ getProfile: () => ++attempts === 1 ? pending.promise : Promise.resolve({ user: second }) });

    const before = commits.length;
    act(() => useAuthStore.getState().login(second, 'session-two'));
    expect(commits[before].querySelector('[name="username"]')).toBeNull();
    await settle();
    expect(input('username')).toHaveValue('second');

    await act(async () => {
      if (outcome === 'success') pending.resolve({ user: customer });
      else pending.reject(new Error('previous error'));
    });
    await settle();
    expect(input('username')).toHaveValue('second');
    expect(useAuthStore.getState().user?.user_id).toBe(2);
    expect(JSON.parse(localStorage.getItem('user')!).username).toBe('second');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)("cannot let a previous save %s clear the new customer's pending save", async (outcome) => {
    const old = deferred<ProfileResponse>(), next = deferred<ProfileResponse>();
    let saves = 0;
    await setup({
      getProfile: config => ({ user: config.headers.get('Authorization') === 'Bearer session-one' ? customer : second }),
      save: () => ++saves === 1 ? old.promise : next.promise,
    });
    edit({ username: 'old write' });
    fireEvent.submit(profileForm()!);

    act(() => useAuthStore.getState().login(second, 'session-two'));
    await settle();
    edit({ username: 'new write' });
    fireEvent.submit(profileForm()!);
    await act(async () => {
      if (outcome === 'success') old.resolve({ user: { ...customer, username: 'old write' } });
      else old.reject(apiError('用户名已被使用'));
    });
    await settle();

    expect(input('username')).toHaveValue('new write');
    expect(button('保存中...')).toBeDisabled();
    expect(useAuthStore.getState().user?.username).toBe('second');

    await act(async () => next.resolve({ user: { ...second, username: 'new write' } }));
    await settle();
    expect(input('username')).toHaveValue('new write');
    expect(screen.getByText(/资料已保存/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user')!).username).toBe('new write');
  });

  it.each(['load', 'save'] as const)('ignores a pending %s after the page is left, leaving stored details unchanged', async (action) => {
    const pending = deferred<ProfileResponse>();
    const { view } = await setup({ getProfile: () => action === 'load' ? pending.promise : Promise.resolve({ user: customer }), save: () => pending.promise });
    if (action === 'save') {
      edit({ username: 'leave write' });
      fireEvent.submit(profileForm()!);
      await settle();
    }
    const before = localStorage.getItem('user');

    view.unmount();
    await act(async () => pending.resolve({ user: { ...customer, username: 'late details' } }));
    await settle();

    expect(localStorage.getItem('user')).toBe(before);
    expect(useAuthStore.getState().user?.username).toBe(customer.username);
  });

  it('cannot submit with changed browser credentials before hydration catches up, and then hides the forms', async () => {
    const { view } = await setup();
    edit({ username: 'draft' });
    const staleSubmit = captureHandler(profileForm()!, 'onSubmit');
    localStorage.setItem('token', 'session-two');

    await staleSubmit();
    expect(requests.map(request => request.method)).toEqual(['get']);

    act(() => view.rerender(<CommitLog commits={[]}><SettingsPage /></CommitLog>));
    expect(document.querySelectorAll('form')).toHaveLength(0);
  });

  it.each(['load', 'save'] as const)("rejects a %s response for a different customer", async (action) => {
    const wrong = { ...customer, user_id: 2, username: 'private second' };
    await setup({ getProfile: async () => ({ user: action === 'load' ? wrong : customer }), save: async () => ({ user: wrong }) });
    if (action === 'save') {
      edit({ username: 'new' });
      await submit();
    }

    expect(screen.getByText(/用户资料响应无效/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private second');
    expect(useAuthStore.getState().user?.username).toBe(customer.username);
  });

  it('offers a reload without reporting success when the save cannot be stored locally', async () => {
    await setup();
    edit({ username: 'saved remotely' });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); });

    await submit();

    expect(screen.getByText(/资料已保存，但本地同步失败/)).toBeInTheDocument();
    expect(button('重新加载资料')).toBeDefined();
    expect(screen.queryByText(/^资料已保存$/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(useAuthStore.getState().user?.username).toBe(customer.username);
  });

  it('lets only the latest reload populate the page for the same customer', async () => {
    const old = deferred<ProfileResponse>(), current = deferred<ProfileResponse>();
    let calls = 0;
    await setup({ getProfile: () => ++calls === 1 ? Promise.reject(new Error('offline')) : calls === 2 ? old.promise : current.promise });
    const reload = captureHandler(button('重新加载资料'));

    void reload();
    void reload();
    await act(async () => current.resolve({ user: { ...customer, username: 'latest details' } }));
    await settle();
    expect(input('username')).toHaveValue('latest details');

    await act(async () => old.resolve({ user: { ...customer, username: 'obsolete details' } }));
    await settle();
    expect(input('username')).toHaveValue('latest details');
    expect(JSON.parse(localStorage.getItem('user')!).username).toBe('latest details');
  });
});
