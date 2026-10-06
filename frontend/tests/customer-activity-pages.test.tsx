import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import { browseApi, cartApi, favoriteApi, productApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { CommitLog, apiError, captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notifications.push(message); };
  const toast = { error: record, success: record };
  return { default: toast, toast };
});
vi.mock('@/lib/api', () => ({
  favoriteApi: { list: vi.fn(), remove: vi.fn() },
  browseApi: { getHistory: vi.fn(), deleteRecord: vi.fn(), clearHistory: vi.fn() },
  productApi: { getDetail: vi.fn() },
  cartApi: { add: vi.fn() },
}));

type Kind = 'favorites' | 'history';
type Row = ReturnType<typeof product>;
type Params = { page: number; limit: number };
type Page = Record<string, unknown>;

const firstUser = { user_id: 1, username: 'first', email: 'first@test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@test' };
const pages = { favorites: FavoritesPage, history: HistoryPage };
const product = (id: number, title: string | null = `Product ${id}`) =>
  ({ favorite_id: id, id, product_id: id, title, price: '10.00' as string | null, stock: 3 as number | string | null, status: 1 as number | null, has_sku: false, browsed_at: '2026-10-02T00:00:00Z' });
const pageOf = (kind: Kind, rows: Row[], total = rows.length, totalPages = Math.ceil(total / 20)) =>
  ({ [kind]: rows, pagination: { total, total_pages: totalPages } });

interface Setup {
  list?: (params: Params) => Promise<Page> | Page;
  remove?: (id: number) => Promise<unknown>;
  clear?: () => Promise<unknown>;
  detail?: (id: number) => Promise<unknown>;
  add?: () => Promise<unknown>;
  confirm?: () => boolean;
  rows?: Row[];
}

let requests: (Params & { token: string | null })[] = [];
let mutations: unknown[][] = [];

async function setup(kind: Kind, { list, remove = async () => ({}), clear = async () => ({}), detail = async id => ({ product: product(id) }),
  add = async () => ({}), confirm = () => true, rows = Array.from({ length: 21 }, (_, index) => product(index + 1)) }: Setup = {}) {
  useAuthStore.getState().login(firstUser, 'first-session');
  vi.stubGlobal('confirm', confirm);
  const listing = async (params: Params) => {
    requests.push({ ...params, token: useAuthStore.getState().token });
    if (list) return list(params);
    return pageOf(kind, rows.slice((params.page - 1) * params.limit, params.page * params.limit), rows.length, Math.ceil(rows.length / params.limit));
  };
  const deleting = async (id: number) => { mutations.push(['remove', id]); return (await remove(id)) as never; };
  vi.mocked(favoriteApi.list).mockImplementation(listing as never);
  vi.mocked(browseApi.getHistory).mockImplementation(listing as never);
  vi.mocked(favoriteApi.remove).mockImplementation(deleting);
  vi.mocked(browseApi.deleteRecord).mockImplementation(deleting);
  vi.mocked(browseApi.clearHistory).mockImplementation(async () => { mutations.push(['clear']); return (await clear()) as never; });
  vi.mocked(productApi.getDetail).mockImplementation(detail as never);
  vi.mocked(cartApi.add).mockImplementation(add as never);
  const Page = pages[kind];
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><Page /></CommitLog>);
  await settle();
  return { view, commits };
}

const titles = (root: HTMLElement = document.body) => within(root).queryAllByRole('heading', { level: 2 }).map(heading => heading.textContent);
/** The largest element around a product heading that holds no other product: its card. */
function card(title: string) {
  let found = screen.getByRole('heading', { name: title }).parentElement!;
  while (found.parentElement && found.parentElement.querySelectorAll('h2').length === 1) found = found.parentElement;
  return found;
}
const removeButtons = (kind: Kind) => Array.from(document.querySelectorAll<HTMLButtonElement>(`button[title="${kind === 'favorites' ? '取消收藏' : '删除记录'}"]`));
const button = (name: string) => screen.queryAllByRole<HTMLButtonElement>('button', { name })[0];
const productRequests = () => vi.mocked(productApi.getDetail).mock.calls;
const cartRequests = () => vi.mocked(cartApi.add).mock.calls;
const switchAccount = () => act(() => useAuthStore.getState().login(secondUser, 'second-session'));

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await settle();
}

beforeEach(() => {
  requests = [];
  mutations = [];
  notifications.length = 0;
});

describe.each(['favorites', 'history'] as const)('%s page', (kind) => {
  const emptyText = kind === 'favorites' ? '暂无收藏商品' : '暂无浏览记录';

  it('shows an alert with a retry instead of an empty list after a failure', async () => {
    let calls = 0;
    await setup(kind, { list: async () => {
      if (++calls === 1) throw apiError('列表暂时不可用', 'message');
      return pageOf(kind, [product(1)]);
    } });

    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText(/列表暂时不可用/)).toBeInTheDocument();
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    expect(screen.getByText(/— 个商品/), 'a failed count is unknown, not zero').toBeInTheDocument();

    await click(button('重新加载'));
    expect(titles()).toEqual(['Product 1']);
    expect(requests).toHaveLength(2);
  });

  it('hides loaded rows and counts at once when the account changes and starts its first page', async () => {
    const nextAccount = deferred<Page>();
    const { commits } = await setup(kind, { list: async params => useAuthStore.getState().token === 'second-session'
      ? nextAccount.promise : pageOf(kind, [product(params.page === 1 ? 1 : 21)], 21, 2) });
    await click(button('下一页'));
    expect(titles()).toEqual(['Product 21']);

    const before = commits.length;
    switchAccount();
    expect(titles(commits[before])).toEqual([]);
    expect(commits[before].textContent).not.toContain('21 个商品');
    await settle();
    expect(requests.at(-1)).toMatchObject({ page: 1, limit: 20 });

    await act(async () => nextAccount.resolve(pageOf(kind, [product(100, 'Second account')])));
    await settle();
    expect(titles()).toEqual(['Second account']);
  });

  it('deduplicates a removal and blocks quick cart and history clearing while it is pending', async () => {
    const removal = deferred();
    await setup(kind, { rows: [product(1)], remove: () => removal.promise });

    act(() => {
      removeButtons(kind)[0].click();
      removeButtons(kind)[0].click();
      button('加入购物车').click();
      if (kind === 'history') button('清空历史').click();
    });
    expect(mutations).toEqual([['remove', 1]]);
    expect(productRequests()).toEqual([]);
    await settle();
    expect(removeButtons(kind)[0]).toBeDisabled();

    await act(async () => removal.resolve({}));
    await settle();
    expect(requests).toHaveLength(2);
    expect(notifications).toHaveLength(1);
  });

  it('keeps missing and null products removable but out of quick cart, and treats string zero stock as sold out', async () => {
    await setup(kind, { rows: [
      { ...product(1, null), price: null, stock: null, status: null },
      { ...product(2, '商品已不存在'), stock: 0, status: -1 },
      { ...product(3), stock: '0' },
    ] });

    expect(titles()).toEqual(['商品已不存在', '商品已不存在', 'Product 3']);
    // MySQL returns stock as the string '0'; that product's card must show it sold out.
    expect(within(card('Product 3')).getByText('已售罄')).toBeInTheDocument();
    const cartButtons = screen.getAllByRole('button', { name: '加入购物车' });
    for (const element of cartButtons) expect(element).toBeDisabled();
    // Disabled buttons ignore clicks; the handlers must refuse as well.
    for (const element of cartButtons) await act(() => captureHandler(element)());
    expect(productRequests()).toEqual([]);
    expect(cartRequests()).toEqual([]);

    await click(removeButtons(kind)[0]);
    expect(mutations).toEqual([['remove', 1]]);
  });

  it('reloads the remaining valid page after deleting the only row on the final page', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => product(index + 1));
    const { commits } = await setup(kind, { rows, remove: async id => { rows.splice(rows.findIndex(row => row.product_id === id), 1); } });
    await click(button('下一页'));
    expect(titles()).toEqual(['Product 21']);
    const before = commits.length;

    await click(removeButtons(kind)[0]);

    expect(requests.at(-1)?.page).toBe(1);
    expect(titles()).toHaveLength(20);
    expect(screen.getByText(/20 个商品/)).toBeInTheDocument();
    for (const commit of commits.slice(before)) {
      expect(commit.textContent, 'the emptied page must not flash an empty collection').not.toContain(emptyText);
    }
  });

  it("lets the next account act at once while the previous account's removal is still pending", async () => {
    const removal = deferred();
    let calls = 0;
    await setup(kind, {
      list: async () => pageOf(kind, [product(useAuthStore.getState().token === 'second-session' ? 2 : 1)]),
      remove: () => ++calls === 1 ? removal.promise : Promise.resolve({}),
    });
    fireEvent.click(removeButtons(kind)[0]);

    switchAccount();
    await settle();
    expect(titles()).toEqual(['Product 2']);
    expect(removeButtons(kind)[0]).toBeEnabled();
    await click(removeButtons(kind)[0]);

    expect(mutations).toEqual([['remove', 1], ['remove', 2]]);
  });

  const lateListCases = (['account', 'storage', 'unmount'] as const).flatMap(change =>
    ([false, true] as const).map(fail => ({ change, fail })));

  it.each(lateListCases)('cannot restore a late list (fails=$fail) after a $change change', async ({ change, fail }) => {
    const pending = deferred<Page>();
    let calls = 0;
    const { view } = await setup(kind, { list: () => ++calls === 1 ? pending.promise : Promise.resolve(pageOf(kind, [product(99, 'New account')])) });

    if (change === 'account') {
      switchAccount();
      await settle();
    }
    if (change === 'storage') localStorage.setItem('token', 'second-session');
    if (change === 'unmount') view.unmount();
    await act(async () => {
      if (fail) pending.reject(new Error('Old failure'));
      else pending.resolve(pageOf(kind, [product(1, 'Old account')]));
    });
    await settle();

    expect(titles()).toEqual(change === 'account' ? ['New account'] : []);
    expect(screen.queryByText(/Old failure/)).not.toBeInTheDocument();
    expect(notifications).toEqual([]);
  });

  it.each([false, true])('keeps a pending page (fails=%s) from replacing the new account, and stale row handlers from deleting', async (fail) => {
    const pending = deferred<Page>();
    let calls = 0;
    await setup(kind, { list: params => {
      calls++;
      if (params.page === 2) return pending.promise;
      return pageOf(kind, [product(calls === 1 ? 1 : 2)], 21, 2);
    } });
    const next = captureHandler(button('下一页'));
    const staleRemove = captureHandler(removeButtons(kind)[0]);

    await act(() => next());
    expect(titles()).toEqual([]);
    await staleRemove();
    expect(mutations).toEqual([]);

    // Changing account is the navigation available while the next page loads.
    switchAccount();
    await settle();
    await act(async () => {
      if (fail) pending.reject(new Error('Old page failure'));
      else pending.resolve(pageOf(kind, [product(21)], 21, 2));
    });
    await settle();
    expect(titles()).toEqual(['Product 2']);
    expect(notifications).toEqual([]);
  });

  it.each(['account', 'storage', 'unmount'] as const)('ignores old remove, quick cart and clear handlers after a %s change', async (change) => {
    const { view } = await setup(kind, { rows: [product(1)] });
    // React clears handlers from nodes it unmounts, so take them first.
    const handlers = [removeButtons(kind)[0], button('加入购物车'), ...(kind === 'history' ? [button('清空历史')] : [])].map(element => captureHandler(element));

    if (change === 'account') switchAccount();
    if (change === 'storage') localStorage.setItem('token', 'second-session');
    if (change === 'unmount') view.unmount();
    for (const handler of handlers) await handler();
    await settle();

    expect(mutations).toEqual([]);
    expect(productRequests()).toEqual([]);
    expect(cartRequests()).toEqual([]);
    expect(notifications).toEqual([]);
  });

  const lateMutationCases = (kind === 'history' ? ['remove', 'clear'] as const : ['remove'] as const).flatMap(action =>
    (['account', 'storage', 'unmount'] as const).flatMap(change => ([false, true] as const).map(fail => ({ action, change, fail }))));

  it.each(lateMutationCases)('neither refreshes nor notifies on a late $action (fails=$fail) after a $change change', async ({ action, change, fail }) => {
    const pending = deferred();
    const { view } = await setup(kind, { rows: [product(1)], remove: () => pending.promise, clear: () => pending.promise });
    fireEvent.click(action === 'clear' ? button('清空历史') : removeButtons(kind)[0]);

    if (change === 'account') {
      switchAccount();
      await settle();
    }
    if (change === 'storage') localStorage.setItem('token', 'second-session');
    if (change === 'unmount') view.unmount();
    const before = requests.length;
    await act(async () => {
      if (fail) pending.reject(new Error('Old mutation failed'));
      else pending.resolve({});
    });
    await settle();

    expect(requests).toHaveLength(before);
    expect(notifications).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('refreshes the displayed page when a deletion finishes after a page change', async () => {
    const pending = deferred();
    await setup(kind, { remove: () => pending.promise });
    const next = captureHandler(button('下一页'));

    fireEvent.click(removeButtons(kind)[0]);
    await act(() => next());
    await settle();
    expect(titles()).toEqual(['Product 21']);

    await act(async () => pending.resolve({}));
    await settle();
    expect(requests.at(-1)?.page).toBe(2);
    expect(titles()).toEqual(['Product 21']);
    expect(notifications).toEqual([]);
  });

  const quickCartCases = (['detail', 'add'] as const).flatMap(phase =>
    (['account', 'storage', 'unmount', 'page'] as const).map(change => ({ phase, change })));

  it.each(quickCartCases)('keeps quick cart scoped when the $phase step finishes after a $change change', async ({ phase, change }) => {
    const pending = deferred();
    const { view } = await setup(kind, {
      detail: phase === 'detail' ? () => pending.promise : async () => ({ product: product(1) }),
      add: phase === 'add' ? () => pending.promise : undefined,
    });
    const next = captureHandler(button('下一页'));

    fireEvent.click(button('加入购物车'));
    await settle(1);
    if (change === 'account') {
      switchAccount();
      await settle();
    }
    if (change === 'storage') localStorage.setItem('token', 'second-session');
    if (change === 'unmount') view.unmount();
    if (change === 'page') {
      await act(() => next());
      await settle();
    }
    await act(async () => pending.resolve(phase === 'detail' ? { product: product(1) } : {}));
    await settle();

    expect(notifications).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(cartRequests()).toHaveLength(phase === 'detail' ? 0 : 1);
  });

  it('sends a SKU product to its detail page to choose a variant', async () => {
    await setup(kind, { rows: [{ ...product(1), has_sku: true }], detail: async () => ({ product: { ...product(1), has_sku: true } }) });

    await click(button('选择规格'));

    expect(router.push.mock.calls).toEqual([['/products/1']]);
    expect(cartRequests()).toEqual([]);
  });

  it('keeps the rows after a failed deletion and allows a retry', async () => {
    let calls = 0;
    await setup(kind, { rows: [product(1)], remove: async () => { if (++calls === 1) throw apiError('删除失败测试', 'message'); } });

    await click(removeButtons(kind)[0]);
    expect(titles()).toEqual(['Product 1']);
    expect(removeButtons(kind)[0]).toBeEnabled();
    expect(notifications).toEqual(['删除失败测试']);

    await click(removeButtons(kind)[0]);
    expect(calls).toBe(2);
    expect(requests).toHaveLength(2);
  });
});

describe('history clear confirmation', () => {
  it.each(['cancel', 'account', 'storage'] as const)('checks identity before and after the prompt and sends nothing (%s)', async (change) => {
    await setup('history', { rows: [product(1)], confirm: () => {
      if (change === 'account') useAuthStore.getState().login(secondUser, 'second-session');
      if (change === 'storage') localStorage.setItem('token', 'second-session');
      return change !== 'cancel';
    } });

    await click(button('清空历史'));
    expect(mutations).toEqual([]);

    if (change === 'cancel') {
      await click(removeButtons('history')[0]);
      expect(mutations, 'a cancelled prompt releases the pending action').toEqual([['remove', 1]]);
    }
  });
});
