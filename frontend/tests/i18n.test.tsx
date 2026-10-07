import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { act, fireEvent, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import AdminCouponsPage from '@/app/admin/coupons/page';
import AdminDashboardPage from '@/app/admin/dashboard/page';
import CouponsPage from '@/app/coupons/page';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import LoginPage from '@/app/login/page';
import MyCouponsPage from '@/app/my/coupons/page';
import AppShell from '@/components/AppShell';
import { useConfirmStore } from '@/lib/confirm';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { accountTranslations } from '@/lib/account-translations';
import { adminTranslations } from '@/lib/admin-translations';
import api, { adminCouponApi, browseApi, couponApi, favoriteApi, userApi } from '@/lib/api';
import { commonTranslations } from '@/lib/common-translations';
import { errorTranslations } from '@/lib/error-translations';
import { formatDate, translate, translateTitle } from '@/lib/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { LOCALE_STORAGE_KEY, useLocaleStore } from '@/store/useLocaleStore';
import { apiError, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const messages = vi.hoisted(() => [] as string[]);
const chart = vi.hoisted(() => ({ tickFormatter: undefined as ((value: string) => string) | undefined, labelFormatter: undefined as ((value: string) => unknown) | undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { messages.push(message); }, success: vi.fn() };
  return { default: toast, toast, Toaster: () => null };
});
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/SiteFooter', () => ({ default: () => null }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
// The chart needs layout measurements happy-dom lacks; record the date formatters it is given.
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Box, LineChart: Box, Line: Empty, CartesianGrid: Empty, YAxis: Empty, Legend: Empty,
    XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) => { chart.tickFormatter = tickFormatter; return null; },
    Tooltip: ({ labelFormatter }: { labelFormatter: (value: string) => unknown }) => { chart.labelFormatter = labelFormatter; return null; },
  };
});
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  userApi: { login: vi.fn() },
  favoriteApi: { list: vi.fn(), remove: vi.fn() },
  browseApi: { getHistory: vi.fn(), deleteRecord: vi.fn(), clearHistory: vi.fn() },
  couponApi: { getAvailable: vi.fn(), getMyCoupons: vi.fn() },
  adminCouponApi: { getList: vi.fn() },
  productApi: { getDetail: vi.fn() },
  cartApi: { add: vi.fn() },
}));

const setLocale = (locale: 'zh-CN' | 'en') => act(() => useLocaleStore.getState().setLocale(locale));
const text = () => document.body.textContent ?? '';
const root = resolve(__dirname, '..');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const dictionaries: Record<string, string> = { ...errorTranslations, ...accountTranslations, ...adminTranslations, ...commonTranslations };

describe('language preference', () => {
  it('hydrates independently of authentication and persists for the next page load', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    localStorage.setItem('session', 'customer-session');
    expect(useLocaleStore.getState().locale, 'the first render matches the Chinese server render').toBe('zh-CN');

    useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe('en');
    useLocaleStore.getState().setLocale('zh-CN');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(localStorage.getItem('session')).toBe('customer-session');

    useLocaleStore.setState(useLocaleStore.getInitialState(), true);
    useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe('zh-CN');
  });

  it('falls back to Chinese for invalid, removed or inaccessible preferences', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, '<invalid>');
    useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe('zh-CN');

    useLocaleStore.getState().setLocale('en');
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe('zh-CN');

    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => useLocaleStore.getState().hydrate()).not.toThrow();
    expect(() => useLocaleStore.getState().setLocale('en')).not.toThrow();
    expect(useLocaleStore.getState().locale).toBe('en');
  });

  it('switches the shared preference from the language control without navigating', () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole('combobox', { name: '界面语言' });
    expect(select).toHaveValue('zh-CN');

    fireEvent.change(select, { target: { value: 'en' } });

    expect(screen.getByRole('combobox', { name: 'Interface language' })).toHaveValue('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('translation', () => {
  it('interpolates values literally and follows language changes', () => {
    expect(translate('登录')).toBe('登录');
    useLocaleStore.getState().setLocale('en');
    expect(translate('登录')).toBe('Sign in');
    expect(translate('搜索结果: {keyword}', { keyword: '中文 $& <script>' })).toBe('Search results: 中文 $& <script>');
    expect(translate('Original user content 中文')).toBe('Original user content 中文');
    useLocaleStore.getState().setLocale('zh-CN');
    expect(translate('搜索结果: {keyword}', { keyword: '手机' })).toBe('搜索结果: 手机');
  });

  it('formats dates in the selected locale and handles missing dates', () => {
    const date = '2026-10-02T10:20:00Z';
    expect(formatDate(date, true)).toBe(new Date(date).toLocaleDateString('zh-CN'));
    useLocaleStore.getState().setLocale('en');
    expect(formatDate(date, true)).toBe(new Date(date).toLocaleDateString('en-US'));
    expect(formatDate(null)).toBe('—');
    expect(formatDate('invalid')).toBe('—');
  });

  it('keeps product names and literal replacement characters in server error templates', () => {
    useLocaleStore.getState().setLocale('en');
    const result = translate('商品 中文 $& {count} 库存不足');
    expect(result).toMatch(/中文 \$& \{count\}/);
    expect(result).not.toMatch(/库存不足/);
    expect(translate('商品 123 不存在或已下架')).toMatch(/123/);
    expect(translate('商品 123 不存在或已下架')).not.toMatch(/不存在/);
  });

  it('translates page titles part by part and covers every static metadata title', () => {
    expect(translateTitle('全部商品 | 电商平台', 'en')).toBe('All products | Shop');
    expect(translateTitle('全部商品 | 电商平台', 'zh-CN')).toBe('全部商品 | 电商平台');
    expect(translateTitle('A | B 商品 | 电商平台', 'en')).toBe('A | B 商品 | Shop');

    const layouts = walk(join(root, 'src/app')).filter(file => /[/\\]layout\.tsx$/.test(file) && !/[/\\]admin[/\\]/.test(file));
    const titles = layouts.flatMap(file => Array.from(readFileSync(file, 'utf8').matchAll(/export const metadata[^;]*?title: (?:\{ default: )?'([^']+)'/g), match => match[1]));
    expect(titles.length, `found ${titles.length} titles`).toBeGreaterThanOrEqual(15);
    for (const title of [...titles, '商品详情', '电商平台']) expect(translate(title, {}, 'en'), `untranslated title ${title}`).not.toBe(title);
  });

  it('covers visible UI literals and keeps placeholders identical in the dictionaries', () => {
    const problems: string[] = [];
    for (const filename of walk(join(root, 'src')).filter(file => file.endsWith('.tsx'))) {
      const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          if (!Object.hasOwn(dictionaries, node.arguments[0].text)) problems.push(`${filename}: untranslated key ${node.arguments[0].text}`);
        }
        if (ts.isJsxText(node) && /[一-鿿]/.test(node.text) && basename(filename) !== 'LanguageSwitcher.tsx') {
          problems.push(`${filename}: untranslated UI text ${node.text.trim()}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const placeholders = (value: string) => Array.from(value.matchAll(/\{(\w+)\}/g), match => match[1]).sort();
    for (const [key, english] of Object.entries(dictionaries)) {
      if (placeholders(english).join() !== placeholders(key).join()) problems.push(`Placeholder mismatch: ${key}`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps the admin dictionary out of storefront code and loads it on every admin screen', () => {
    const storefront: Record<string, string> = { ...errorTranslations, ...accountTranslations, ...commonTranslations };
    const isAdmin = (file: string) => file.includes('/src/app/admin/') || basename(file).startsWith('Admin');
    const problems: string[] = [];
    for (const filename of walk(join(root, 'src')).filter(file => /\.tsx?$/.test(file))) {
      const code = readFileSync(filename, 'utf8');
      const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let usesT = false;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          usesT = true;
          if (!isAdmin(filename) && !Object.hasOwn(storefront, node.arguments[0].text)) {
            problems.push(`${filename}: storefront key ${node.arguments[0].text} is only in the admin dictionary`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      const loadsAdmin = /from '@\/lib\/admin-translations'|'@\/lib\/admin-i18n'/.test(code);
      if (isAdmin(filename) && usesT && !code.includes("import '@/lib/admin-i18n';")) problems.push(`${filename}: admin screen without @/lib/admin-i18n`);
      if (!isAdmin(filename) && loadsAdmin && !filename.endsWith('/lib/admin-i18n.ts')) problems.push(`${filename}: storefront code loads the admin dictionary`);
    }
    // A shared key translates one way everywhere; the admin dictionary only adds admin-only keys.
    problems.push(...Object.keys(adminTranslations).filter(key => Object.hasOwn(storefront, key)).map(key => `admin dictionary repeats ${key}`));
    expect(problems).toEqual([]);
  });
});

describe('language changes on rendered pages', () => {
  it('keeps entered login values when the language changes and translates server failures', async () => {
    vi.mocked(userApi.login).mockRejectedValue(apiError('邮箱或密码错误'));
    render(<LoginPage />);
    await settle();
    expect(text()).toMatch(/登录账号/);
    fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: 'customer@example.test' } });
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'example-password' } });

    setLocale('en');
    expect(text()).toMatch(/Sign in to your account/);
    expect(document.querySelector('input[type="email"]')).toHaveValue('customer@example.test');
    expect(document.querySelector('input[type="password"]')).toHaveValue('example-password');

    fireEvent.submit(document.querySelector('form')!);
    await settle();
    expect(vi.mocked(userApi.login).mock.calls[0][0]).toMatchObject({ email: 'customer@example.test', password: 'example-password' });
    expect(messages.at(-1)).toMatch(/email|password/i);
    expect(messages.at(-1)).not.toMatch(/[一-鿿]/);

    setLocale('zh-CN');
    expect(text()).toMatch(/登录账号/);
  });

  it('keeps html lang and titles in step with the preference across tabs without touching sessions', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    localStorage.setItem('session', 'customer-session');
    document.documentElement.lang = 'zh-CN';
    document.title = '全部商品 | 电商平台';
    // Counts title observers and caps their callbacks: two live observers translating the title
    // in opposite directions would otherwise rewrite it forever and hang the test run.
    const observers = { created: 0, disconnected: 0, callbacks: 0 };
    const Native = MutationObserver;
    vi.stubGlobal('MutationObserver', class extends Native {
      constructor(callback: MutationCallback) {
        super((...args) => { if (++observers.callbacks <= 100) callback(...args); });
        observers.created++;
      }
      disconnect() { observers.disconnected++; super.disconnect(); }
    });
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    // Next.js replaces the title after navigation or streamed metadata.
    const nextSetsTitle = async (title: string) => {
      document.title = title;
      await settle();
    };

    const view = render(<AppShell>page</AppShell>);
    await settle();
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('All products | Shop');
    await nextSetsTitle('登录 | 电商平台');
    expect(document.title).toBe('Sign in | Shop');
    await nextSetsTitle('iPhone 15 Pro | 电商平台');
    expect(document.title).toBe('iPhone 15 Pro | Shop');

    localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: LOCALE_STORAGE_KEY })); });
    await settle();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('iPhone 15 Pro | 电商平台');
    expect(localStorage.getItem('session')).toBe('customer-session');

    view.unmount();
    const storageListeners = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'storage').map(([, listener]) => listener);
    expect(storageListeners(removed)).toEqual(expect.arrayContaining(storageListeners(added)));
    expect(observers.callbacks, 'title observers must not keep rewriting the title').toBeLessThan(100);
    expect(observers.disconnected).toBe(observers.created);
  });

  it('mounts the site confirmation dialog for every page', async () => {
    render(<AppShell>page</AppShell>);
    await settle();
    act(() => useConfirmStore.setState({ request: { message: '确定要取消订单吗？', resolve: vi.fn() } }));
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('确定要取消订单吗？');
    act(() => useConfirmStore.setState({ request: null }));
  });

  it.each([['favorites', FavoritesPage], ['history', HistoryPage]] as const)('%s keeps the real names of deleted products in both languages', async (collection, Page) => {
    useAuthStore.getState().login({ user_id: 1, username: 'customer', email: 'customer@example.test' }, 'session');
    const rows = [
      { product_id: 1, favorite_id: 1, id: 1, title: '原有商品名', status: -1, stock: 0, price: 80 },
      { product_id: 2, favorite_id: 2, id: 2, title: '商品已不存在', status: -1, stock: 0, price: 0 },
    ];
    const list = collection === 'favorites' ? favoriteApi.list : browseApi.getHistory;
    vi.mocked(list).mockResolvedValue({ [collection]: rows, pagination: { total: 2, total_pages: 1 } } as never);
    render(<Page />);
    await settle();
    expect(text()).toMatch(/原有商品名/);

    setLocale('en');

    expect(text()).toMatch(/原有商品名/);
    expect(text()).toMatch(/Product no longer available/);
    expect(text()).not.toMatch(/商品已不存在/);
  });

  it.each([['coupons', CouponsPage], ['my/coupons', MyCouponsPage], ['admin/coupons', AdminCouponsPage]] as [string, ComponentType][])(
    '%s changes percentage wording on a language change without refetching or rewriting coupon data', async (_, Page) => {
      useAuthStore.getState().login({ user_id: 1, username: 'customer', email: 'customer@example.test' }, 'session');
      localStorage.setItem('admin_session', 'admin-session');
      localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
      const coupon = { coupon_id: 1, user_coupon_id: 7, name: '原始中文券名', code: 'EXAMPLE20', type: 2,
        discount_value: '20.00', min_amount: 0, max_discount: '50.00', total_quantity: 10, remain_quantity: 5,
        per_user_limit: 1, status: 1, coupon_status: 1, received_at: '2026-01-01T00:00:00Z',
        start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', expired_at: '2099-01-01T00:00:00Z' };
      let loads = 0;
      const load = async () => { loads++; return { data: [coupon] }; };
      for (const fn of [couponApi.getAvailable, couponApi.getMyCoupons, adminCouponApi.getList]) vi.mocked(fn).mockImplementation(load as never);
      render(<Page />);
      await settle();
      expect(text()).toMatch(/8折/);
      const count = loads;

      setLocale('en');
      await settle();

      expect(text()).toMatch(/20% off/);
      expect(text()).not.toMatch(/8折|80% off/);
      expect(text()).toMatch(/原始中文券名/);
      expect(loads).toBe(count);
      expect(coupon.discount_value).toBe('20.00');
    });

  it('keeps UTC calendar days on the sales chart while order timestamps use local time', async () => {
    localStorage.setItem('admin_session', 'chart-session');
    localStorage.setItem('admin_user', JSON.stringify({ username: 'chart-admin' }));
    // West of UTC, midnight UTC is still the previous local day; only the UTC option keeps Oct 2.
    vi.stubEnv('TZ', 'America/Los_Angeles');
    vi.mocked(api.get).mockImplementation((async (url: string) => url === '/admin/dashboard/sales-trend'
      ? [{ date: '2026-10-02T00:00:00.000Z', revenue: 80, order_count: 1 }] : url === '/admin/dashboard/stats' ? {} : []) as never);
    useLocaleStore.getState().setLocale('en');
    render(<AdminDashboardPage />);
    await settle();

    for (const value of ['2026-10-02', '2026-10-02T00:00:00.000Z']) {
      expect(chart.tickFormatter?.(value)).toBe('10/2/2026');
      expect(chart.labelFormatter?.(value)).toBe('10/2/2026');
    }
    expect(formatDate('2026-10-02T00:00:00.000Z')).toBe(new Date('2026-10-02T00:00:00.000Z').toLocaleString('en-US'));
    expect(formatDate('2026-10-02T00:00:00.000Z', true), 'the time zone really is west of UTC').toBe('10/1/2026');
  });
});
