import { installCatalogRouter } from './catalog-router';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '@/components/ProductList';
import Header from '@/components/Header';
import { productApi, searchApi, type Product, type SearchKeyword } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>() }));
const errors = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', async () => {
  const { useCatalogSearchParams } = await import('./catalog-router');
  return { useRouter: () => router, useSearchParams: () => useCatalogSearchParams(query), usePathname: () => '/' };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { errors.push(message); }, success: vi.fn() };
  return { default: toast, toast };
});
// Cards have their own tests; here each one only names its product.
vi.mock('@/components/ProductCard', () => ({
  default: ({ product }: { product: Product }) => <div data-testid="product-card">{product.title}</div>,
  ProductCardSkeleton: () => <div data-testid="product-skeleton" />,
}));
vi.mock('@/lib/api', () => ({
  searchApi: { getHistory: vi.fn(), getHot: vi.fn(async () => ({ keywords: [] })), record: vi.fn(async () => ({})), deleteKeyword: vi.fn(async () => ({})) },
  productApi: { list: vi.fn(), getCategories: vi.fn(async () => []) },
}));

type History = { history: SearchKeyword[] };
type ProductList = Awaited<ReturnType<typeof productApi.list>>;

const userA = { user_id: 1, username: 'A', email: 'a@test' };
const userB = { user_id: 2, username: 'B', email: 'b@test' };
const keyword = (text: string) => ({ keyword: text }) as SearchKeyword;

beforeEach(() => {
  installCatalogRouter(router, query);
  errors.length = 0;
  query.current = new URLSearchParams({ keyword: 'old' });
});

describe('header search history', () => {
  async function setup(getHistory: () => Promise<History> = async () => ({ history: [keyword('My search')] })) {
    vi.mocked(searchApi.getHistory).mockImplementation(getHistory);
    const view = render(<Header />);
    await settle();
    return view;
  }

  async function openHistory() {
    fireEvent.focus(document.querySelector('form[role="search"] input')!);
    await settle();
  }

  it.each(['zh-CN', 'en'] as const)('rejects an overlong search before navigation or recording (%s)', async locale => {
    useAuthStore.getState().login(userA, 'session-A');
    useLocaleStore.setState({ locale });
    await setup(async () => ({ history: [] }));
    const input = screen.getByRole('textbox', { name: locale === 'en' ? 'Search products' : '搜索商品' });
    // Bypass the native limit to prove the submit handler also protects the API contract.
    fireEvent.change(input, { target: { value: 'x'.repeat(101) } });
    fireEvent.submit(input.closest('form')!);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(searchApi.record).not.toHaveBeenCalled();
    expect(errors).toContain(locale === 'en' ? 'Search keywords must not exceed 100 characters' : '搜索关键词最多100个字符');
  });

  it('limits normal typing to 100 characters and still submits the boundary keyword', async () => {
    useAuthStore.getState().login(userA, 'session-A');
    await setup(async () => ({ history: [] }));
    const input = screen.getByRole('textbox', { name: '搜索商品' });
    expect(input).toHaveAttribute('maxlength', '100');
    const typing = userEvent.setup();
    await typing.type(input, 'x'.repeat(101));
    expect(input).toHaveValue('x'.repeat(100));
    await typing.click(screen.getByRole('button', { name: '搜索' }));
    await settle();
    expect(router.push).toHaveBeenCalledWith(`/products?keyword=${'x'.repeat(100)}`);
    expect(searchApi.record).toHaveBeenCalledWith('x'.repeat(100));
  });

  it.each(['zh-CN', 'en'] as const)('deletes a history entry without submitting the populated search form (%s)', async locale => {
    useAuthStore.getState().login(userA, 'session-A');
    useLocaleStore.setState({ locale });
    let stored = [keyword('My search'), keyword('Keep this')];
    vi.mocked(searchApi.deleteKeyword).mockImplementation(async value => {
      stored = stored.filter(item => item.keyword !== value);
      return {} as never;
    });
    vi.mocked(searchApi.record).mockImplementation(async value => {
      stored.push(keyword(value));
      return {} as never;
    });
    await setup(async () => ({ history: [...stored] }));
    const input = document.querySelector<HTMLInputElement>('form[role="search"] input')!;
    fireEvent.change(input, { target: { value: '  My search  ' } });
    await openHistory();
    const click = userEvent.setup();

    await click.click(screen.getByRole('button', { name: locale === 'en' ? 'Delete search history: My search' : '删除搜索历史：My search' }));
    await settle();

    expect(searchApi.deleteKeyword).toHaveBeenCalledExactlyOnceWith('My search');
    expect(searchApi.record).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(input).toHaveValue('  My search  ');
    expect(screen.queryByText('My search')).not.toBeInTheDocument();
    expect(screen.getByText('Keep this')).toBeVisible();

    await click.click(screen.getByRole('button', { name: locale === 'en' ? 'Search' : '搜索' }));
    await settle();
    expect(searchApi.record).toHaveBeenCalledExactlyOnceWith('My search');
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/products?keyword=My%20search');
    await openHistory();
    expect(screen.getByText('My search')).toBeVisible();
  });

  it('keeps the history and query in place when deleting fails without submitting a search', async () => {
    useAuthStore.getState().login(userA, 'session-A');
    vi.mocked(searchApi.deleteKeyword).mockRejectedValue(new Error('Delete unavailable'));
    await setup();
    const input = document.querySelector<HTMLInputElement>('form[role="search"] input')!;
    fireEvent.change(input, { target: { value: 'Other search' } });
    await openHistory();

    await userEvent.setup().click(screen.getByRole('button', { name: '删除搜索历史：My search' }));
    await settle();

    expect(searchApi.deleteKeyword).toHaveBeenCalledExactlyOnceWith('My search');
    expect(searchApi.record).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(searchApi.getHistory).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('Other search');
    expect(screen.getByText('My search')).toBeVisible();
  });

  it('loads once the persisted customer hydrates after the header mounts', async () => {
    await setup();
    localStorage.setItem('session', 'session-A');
    localStorage.setItem('user', JSON.stringify(userA));

    act(() => useAuthStore.getState().hydrate());
    await settle();
    await openHistory();

    expect(searchApi.getHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('My search')).toBeInTheDocument();
  });

  it("never shows customer A's late history to customer B", async () => {
    const pending = deferred<History>();
    let calls = 0;
    useAuthStore.getState().login(userA, 'session-A');
    await setup(() => ++calls === 1 ? pending.promise : Promise.resolve({ history: [keyword('B search')] }));

    act(() => useAuthStore.getState().login(userB, 'session-B'));
    await settle();
    await openHistory();
    await act(async () => pending.resolve({ history: [keyword('Private A search')] }));
    await settle();

    expect(screen.getByText('B search')).toBeInTheDocument();
    expect(screen.queryByText('Private A search')).not.toBeInTheDocument();
  });

  it.each(['record', 'delete'] as const)('keeps a stale %s action and its late result away from the next account', async (operation) => {
    const pending = deferred();
    useAuthStore.getState().login(userA, 'session-A');
    if (operation === 'record') vi.mocked(searchApi.record).mockReturnValue(pending.promise as never);
    else vi.mocked(searchApi.deleteKeyword).mockReturnValue(pending.promise as never);
    await setup(async () => ({ history: [keyword('Own history')] }));
    await openHistory();
    fireEvent.change(document.querySelector('form[role="search"] input')!, { target: { value: '  My query  ' } });
    await settle();
    const action = operation === 'record'
      ? captureHandler(document.querySelector('form[role="search"]')!, 'onSubmit')
      : captureHandler(document.querySelector('button[title="删除"]')!);
    const mutations = () => vi.mocked(operation === 'record' ? searchApi.record : searchApi.deleteKeyword).mock.calls.length;

    const work = action();
    expect(mutations()).toBe(1);
    if (operation === 'record') expect(router.push.mock.calls[0]).toEqual(['/products?keyword=My%20query']);
    act(() => useAuthStore.getState().login(userB, 'session-B'));
    await settle();
    await action();
    expect(mutations()).toBe(1);

    await act(async () => pending.resolve({}));
    await work;
    await settle();
    expect(searchApi.getHistory).toHaveBeenCalledTimes(2);
  });

  it.each(['rotation', 'storage', 'unmount'] as const)('ignores a history response after token %s', async (change) => {
    const pending = deferred<History>();
    let calls = 0;
    useAuthStore.getState().login(userA, 'session-A');
    const view = await setup(() => ++calls === 1 ? pending.promise : Promise.resolve({ history: [keyword('Fresh history')] }));

    if (change === 'rotation') {
      act(() => useAuthStore.getState().login(userA, 'rotated-session'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('session', 'other-session');
    if (change === 'unmount') view.unmount();
    await act(async () => pending.resolve({ history: [keyword('Obsolete private history')] }));
    await settle();
    if (change !== 'unmount') await openHistory();

    expect(screen.queryByText('Obsolete private history')).not.toBeInTheDocument();
    if (change === 'rotation') expect(screen.getByText('Fresh history')).toBeInTheDocument();
  });

  it('fails closed without crashing when browser storage is unavailable', async () => {
    useAuthStore.getState().login(userA, 'session-A');
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });

    await setup();

    expect(searchApi.getHistory).not.toHaveBeenCalled();
    expect(document.querySelector('form[role="search"]')).not.toBeNull();
  });

  it('hides cached private history when browser credentials change before hydration', async () => {
    useAuthStore.getState().login(userA, 'session-A');
    const view = await setup();
    await openHistory();
    expect(screen.getByText('My search')).toBeInTheDocument();

    localStorage.setItem('session', 'session-B');
    act(() => view.rerender(<Header />));

    expect(screen.queryByText('My search')).not.toBeInTheDocument();
  });

});

describe('product search results', () => {
  async function setup(list: (params: { keyword: string; sort: string; page: number }) => Promise<ProductList>) {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.mocked(productApi.list).mockImplementation(list as never);
    const view = render(<ProductsPage />);
    await settle();
    return {
      setQuery: async (value: Record<string, string> | URLSearchParams, { wait = true } = {}) => {
        query.current = new URLSearchParams(value);
        act(() => view.rerender(<ProductsPage />));
        if (wait) await settle();
      },
      view,
    };
  }

  const result = (title: string, pages = 1): ProductList =>
    ({ products: [{ product_id: 1, title } as Product], total: pages * 20, page: 1, limit: 20, totalPages: pages });
  const cards = () => screen.queryAllByTestId('product-card').map(card => card.textContent);
  const lastRequest = () => vi.mocked(productApi.list).mock.lastCall?.[0] as { page?: number } | undefined;

  async function clickPage(page: string) {
    fireEvent.click(screen.getByRole('button', { name: page }));
    await settle();
  }

  it('cannot let a late old search overwrite the newer keyword results', async () => {
    const old = deferred<ProductList>(), next = deferred<ProductList>();
    const { setQuery } = await setup(params => params.keyword === 'old' ? old.promise : next.promise);

    await setQuery({ keyword: 'new' });
    await act(async () => next.resolve(result('New result')));
    await settle();
    expect(cards()).toEqual(['New result']);

    await act(async () => old.resolve(result('Old result')));
    await settle();
    expect(cards()).toEqual(['New result']);
  });

  it('requests page one and hides old cards at once when the keyword changes from a later page', async () => {
    const next = deferred<ProductList>();
    const { setQuery } = await setup(params => params.keyword === 'old' ? Promise.resolve(result(`Old page ${params.page}`, 3)) : next.promise);
    await clickPage('3');
    expect(cards()).toEqual(['Old page 3']);

    await setQuery({ keyword: 'new' }, { wait: false });
    expect(cards()).toEqual([]);
    await settle();
    expect(lastRequest()?.page).toBe(1);

    await act(async () => next.resolve(result('New page one')));
    await settle();
    expect(cards()).toEqual(['New page one']);
  });

  it('shows an error with a retry rather than an empty result after a failed search', async () => {
    let calls = 0;
    await setup(async () => {
      if (++calls === 1) throw new Error('Offline');
      return result('Recovered');
    });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.queryByText('暂无商品')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(cards()).toEqual(['Recovered']);
  });

  it('navigates within the product list when sorting and resets a later page', async () => {
    const { setQuery } = await setup(async params => result(`${params.sort} page ${params.page}`, 3));
    await clickPage('3');

    fireEvent.change(screen.getByLabelText('排序:'), { target: { value: 'price ASC' } });
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(new URL(router.push.mock.calls[0][0], 'http://localhost').searchParams.get('page')).toBe('3');
    const next = new URL(router.push.mock.lastCall![0], 'http://localhost').searchParams;
    expect(next.get('keyword')).toBe('old');
    expect(next.get('sort')).toBe('price ASC');

    await setQuery(next);
    expect(lastRequest()?.page).toBe(1);
    expect(cards()).toEqual(['price ASC page 1']);
  });

  it('starts at page one when returning to an earlier keyword while its replacement is pending', async () => {
    const pending = deferred<ProductList>();
    const { setQuery } = await setup(params => params.keyword === 'new' ? pending.promise : Promise.resolve(result(`Old page ${params.page}`, 3)));
    await clickPage('3');

    await setQuery({ keyword: 'new' });
    await setQuery({ keyword: 'old' });

    expect(lastRequest()?.page).toBe(1);
    expect(cards()).toEqual(['Old page 1']);
    await act(async () => pending.resolve(result('Obsolete new result')));
    await settle();
    expect(cards()).toEqual(['Old page 1']);
  });

  it.each(['query', 'unmount'] as const)('cannot clear products or show an error from an old failure after a %s change', async (change) => {
    const pending = deferred<ProductList>();
    const { setQuery, view } = await setup(params => params.keyword === 'old' ? pending.promise : Promise.resolve(result('Current result')));

    if (change === 'query') await setQuery({ keyword: 'new' });
    else view.unmount();
    await act(async () => pending.reject(new Error('Obsolete failure')));
    await settle();

    expect(errors).toEqual([]);
    if (change === 'query') expect(cards()).toEqual(['Current result']);
  });

  it('cannot replace the current pagination through an obsolete page button', async () => {
    const { setQuery } = await setup(async params => result(params.keyword, params.keyword === 'old' ? 3 : 1));
    const oldPage = captureHandler(screen.getByRole('button', { name: '3' }));

    await setQuery({ keyword: 'new' });
    await act(() => oldPage());
    await settle();

    expect(screen.getByText('共找到 20 件商品')).toBeInTheDocument();
    expect(cards()).toEqual(['new']);
  });
});
