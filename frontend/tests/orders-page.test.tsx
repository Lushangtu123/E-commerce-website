import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/orders/page';
import { orderApi, type Order } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { CommitLog, apiError, captureHandler, clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useRouter: () => router, useSearchParams: () => {
    // Next integrates native history writes with useSearchParams; simulate that subscription here.
    const search = useSyncExternalStore(listener => {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    }, () => window.location.search, () => '');
    return new URLSearchParams(search);
  } };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notifications.push(message); };
  const toast = { error: record, success: record };
  return { default: toast, toast };
});
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn(async () => ({ mode: 'demo', canPay: true, isDemo: true })) },
  orderApi: { list: vi.fn(), pay: vi.fn(), cancel: vi.fn(), confirm: vi.fn() },
}));

type Action = 'pay' | 'cancel' | 'confirm';
type OrderList = Awaited<ReturnType<typeof orderApi.list>>;
type ListParams = { page: number; limit: number; status?: number };

const firstUser = { user_id: 1, username: 'first', email: 'first@test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@test' };
const order = (id: number, status = 0, prefix = 'ORDER'): Order =>
  ({ order_id: id, order_no: `${prefix}-${id}`, status, total_amount: '10.00', created_at: '2026-10-02T00:00:00Z' });
const page = (orders: Order[], total: number, totalPages: number): OrderList => ({ orders, total, page: 1, limit: 10, totalPages });
const actionLabel = { pay: '模拟支付', cancel: '取消订单', confirm: '确认收货' } as const;

interface Setup {
  list?: (params: ListParams) => Promise<OrderList>;
  pay?: () => Promise<unknown>;
  cancel?: () => Promise<unknown>;
  confirmOrder?: () => Promise<unknown>;
  search?: string;
  confirm?: () => boolean;
}

let mutations: [Action, number][] = [];
const requests = () => vi.mocked(orderApi.list).mock.calls.map(([params]) => params);

async function setup({ list, pay = async () => ({}), cancel = async () => ({}), confirmOrder = async () => ({}), search = '', confirm = () => true }: Setup = {}) {
  useAuthStore.getState().login(firstUser, 'first-session');
  if (search) window.history.replaceState(null, '', `/orders${search}`);
  vi.stubGlobal('confirm', confirm);
  const all = Array.from({ length: 13 }, (_, index) => order(index + 1, index < 10 ? 0 : 4));
  const byStatus = async ({ page: number, limit, status }: ListParams) => {
    const filtered = status == null ? all : all.filter(item => item.status === status);
    return { orders: filtered.slice((number - 1) * limit, number * limit), total: filtered.length, page: number, limit, totalPages: Math.ceil(filtered.length / limit) };
  };
  vi.mocked(orderApi.list).mockImplementation(params => (list ?? byStatus)(params as ListParams));
  const mutation = (action: Action, run: () => Promise<unknown>) => async (id: number) => {
    mutations.push([action, id]);
    return (await run()) as never;
  };
  vi.mocked(orderApi.pay).mockImplementation(mutation('pay', pay));
  vi.mocked(orderApi.cancel).mockImplementation(mutation('cancel', cancel));
  vi.mocked(orderApi.confirm).mockImplementation(mutation('confirm', confirmOrder));
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><OrdersPage /></CommitLog>);
  await settle();
  return { view, commits };
}

const button = (label: string) => screen.getByRole<HTMLButtonElement>('button', { name: label });
const actionButtons = () => screen.queryAllByRole<HTMLButtonElement>('button', { name: /^(模拟支付|取消订单|确认收货)$/ });
const displayedOrders = (root: HTMLElement = document.body) =>
  within(root).queryAllByText(/^订单号: /).map(element => element.textContent!.slice('订单号: '.length));

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await settle();
}

describe('orders page', () => {
  beforeEach(() => {
    notifications.length = 0;
    mutations = [];
    for (const method of ['pushState', 'replaceState'] as const) {
      const native = window.history[method].bind(window.history);
      vi.spyOn(window.history, method).mockImplementation((...args) => {
        native(...args);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    }
  });

  it('pages thirteen orders ten at a time and resets to page one when filtering cancellations', async () => {
    await setup();
    expect(requests()).toEqual([{ page: 1, limit: 10 }]);
    expect(screen.getByText('共 13 个订单')).toBeInTheDocument();
    expect(displayedOrders()).toEqual(Array.from({ length: 10 }, (_, index) => `ORDER-${index + 1}`));
    expect(button('上一页')).toBeDisabled();
    expect(button('下一页')).toBeEnabled();

    await click(button('下一页'));
    expect(requests().at(-1)).toEqual({ page: 2, limit: 10 });
    expect(displayedOrders()).toEqual(['ORDER-11', 'ORDER-12', 'ORDER-13']);
    expect(button('下一页')).toBeDisabled();

    await click(button('已取消'));
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10, status: 4 });
    expect(screen.getByText('共 3 个订单')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
    expect(button('上一页')).toBeDisabled();
  });

  it.each(['0', '1', '2', '3', '4', '5', '-1', '00', 'NaN', ''])('starts from a legal profile status link once and ignores malformed ones (status=%s)', async (value) => {
    await setup({ search: `?status=${value}` });
    expect(requests()).toEqual([{ page: 1, limit: 10, ...(/^[0-4]$/.test(value) && { status: Number(value) }) }]);
  });

  it.each(['zh-CN', 'en'] as const)('keeps status buttons, URL and reload consistent in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { view } = await setup({ search: '?status=0&source=profile' });
    await click(button(locale === 'en' ? 'Cancelled' : '已取消'));
    expect(new URLSearchParams(window.location.search).get('status')).toBe('4');
    expect(new URLSearchParams(window.location.search).get('source')).toBe('profile');
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10, status: 4 });
    view.unmount();
    await setup({ search: window.location.search });
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10, status: 4 });
    await click(button(locale === 'en' ? 'All' : '全部'));
    expect(new URLSearchParams(window.location.search).has('status')).toBe(false);
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10 });
  });

  it('follows Header and history URL changes without remounting and resets pagination', async () => {
    await setup({ search: '?status=4', list: async params => page([order(params.page, params.status ?? 0)], 13, 2) });
    await click(button('下一页'));
    expect(requests().at(-1)).toEqual({ page: 2, limit: 10, status: 4 });
    for (const [url, status] of [['/orders', undefined], ['/orders?status=0', 0], ['/orders?status=4', 4]] as const) {
      act(() => window.history.replaceState(null, '', url));
      await settle();
      expect(requests().at(-1)).toEqual({ page: 1, limit: 10, ...(status !== undefined && { status }) });
      expect(button(status === undefined ? '全部' : status === 0 ? '待支付' : '已取消')).toHaveClass('bg-primary-600');
    }
  });

  it.each(['?status=0&status=4', '?status=3&status=3', '?status=1%0A', '?status=1e0'])('ambiguous or noncanonical status links default to all: %s', async search => {
    await setup({ search });
    expect(requests()).toEqual([{ page: 1, limit: 10 }]);
    expect(button('全部')).toHaveClass('bg-primary-600');
  });

  it('clears a previous customer filter from the URL and blocks an old handler immediately on navigation', async () => {
    await setup({ search: '?status=0&source=profile' });
    const stale = captureHandler(screen.getAllByRole('button', { name: '取消订单' })[0]);
    act(() => window.history.replaceState(null, '', '/orders?status=4&source=profile'));
    await stale();
    expect(mutations).toEqual([]);
    act(() => useAuthStore.getState().login(secondUser, 'second-session'));
    await settle();
    expect(window.location.search).toBe('?source=profile');
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10 });
    expect(button('全部')).toHaveClass('bg-primary-600');
  });

  it.each(['success', 'failure'] as const)('hides old rows immediately on filter and page changes and ignores a late quick-filter %s', async (outcome) => {
    const pending = deferred<OrderList>();
    const { commits } = await setup({ list: async params => params.status === 0 ? pending.promise
      : page([order(1, params.status ?? 3, params.status === 4 ? 'CANCELLED' : 'ALL')], 13, 2) });
    expect(displayedOrders()).toEqual(['ALL-1']);

    let before = commits.length;
    await click(button('下一页'));
    expect(displayedOrders(commits[before])).toEqual([]);

    before = commits.length;
    await click(button('待支付'));
    expect(displayedOrders(commits[before])).toEqual([]);

    await click(button('已取消'));
    expect(displayedOrders()).toEqual(['CANCELLED-1']);

    await act(async () => {
      if (outcome === 'success') pending.resolve(page([order(99, 0, 'LATE')], 1, 1));
      else pending.reject(new Error('Late unavailable'));
    });
    await settle();
    expect(displayedOrders()).toEqual(['CANCELLED-1']);
    expect(notifications).toEqual([]);
  });

  it.each(['loaded', 'pending'] as const)('hides %s results of the previous customer at once and resets filter and page', async (previousState) => {
    const pending = deferred<OrderList>();
    const { commits } = await setup({ search: '?status=0', list: async params => {
      if (useAuthStore.getState().sessionId === 'second-session') return page([order(1, 3, 'SECOND')], 1, 1);
      if (previousState === 'pending' && params.page === 2) return pending.promise;
      return page([order(1, 0, 'FIRST')], 13, 2);
    } });
    await click(button('下一页'));

    const before = commits.length;
    act(() => useAuthStore.getState().login(secondUser, 'second-session'));
    expect(displayedOrders(commits[before])).toEqual([]);
    await settle();
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10 });
    expect(displayedOrders()).toEqual(['SECOND-1']);

    await act(async () => pending.resolve(page([order(99, 0, 'LATE-FIRST')], 99, 10)));
    await settle();
    expect(displayedOrders()).toEqual(['SECOND-1']);
  });

  it('does not show a filter\'s earlier rows again while returning to it', async () => {
    const pending = deferred<OrderList>();
    let unfiltered = 0;
    await setup({ list: async params => params.status === 4 ? page([order(1, 4, 'CANCELLED')], 1, 1)
      : ++unfiltered === 1 ? page([order(1, 0, 'BEFORE')], 1, 1) : pending.promise });
    await click(button('已取消'));

    await click(button('全部'));
    expect(displayedOrders()).toEqual([]);

    await act(async () => pending.resolve(page([order(1, 1, 'AFTER')], 1, 1)));
    await settle();
    expect(displayedOrders()).toEqual(['AFTER-1']);
  });

  it('sends no list request for a filter chosen after another tab changed the session', async () => {
    await setup();
    localStorage.setItem('session', 'other-tab-session');

    await click(button('已取消'));
    expect(requests()).toHaveLength(1);
  });

  it('starts the next customer unfiltered even when the previous one never touched a status link\'s filter', async () => {
    await setup({ search: '?status=0', list: async () => page([order(1)], 1, 1) });
    expect(requests()).toEqual([{ page: 1, limit: 10, status: 0 }]);

    act(() => useAuthStore.getState().login(secondUser, 'second-session'));
    await settle();
    expect(requests().at(-1)).toEqual({ page: 1, limit: 10 });
  });

  it('shows a retryable error instead of an empty history when the list fails, and loads again on retry', async () => {
    const retry = deferred<OrderList>();
    let calls = 0;
    await setup({ list: async () => {
      if (++calls === 1) throw apiError('订单服务暂不可用');
      return retry.promise;
    } });
    expect(screen.getByRole('alert')).toHaveTextContent('订单服务暂不可用');
    expect(screen.queryByText('暂无订单')).not.toBeInTheDocument();
    expect(vi.mocked(logger.error).mock.calls).toEqual([['加载订单失败:', expect.objectContaining({ response: expect.anything() })]]);

    await click(button('重新加载'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();

    await act(async () => retry.resolve(page([order(1)], 1, 1)));
    await settle();
    expect(displayedOrders()).toEqual(['ORDER-1']);
    expect(requests()).toHaveLength(2);
  });

  it('shows the error of a failed refresh after payment, and loading again while it is retried', async () => {
    const retry = deferred<OrderList>();
    let calls = 0;
    await setup({ list: async () => {
      calls++;
      if (calls === 1) return page([order(1)], 1, 1);
      if (calls === 2) throw apiError('订单刷新失败');
      return retry.promise;
    } });

    await click(button('模拟支付'));
    expect(screen.getByRole('alert')).toHaveTextContent('订单刷新失败');

    await click(button('重新加载'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => retry.resolve(page([order(1, 1)], 1, 1)));
    await settle();
    expect(screen.getByText('已支付', { selector: 'span' })).toBeInTheDocument();
  });

  it('rejects duplicate pay or cancel on a pending order and refreshes only after payment succeeds', async () => {
    const payment = deferred();
    const confirm = vi.fn(() => true);
    await setup({ pay: () => payment.promise, confirm });
    const pay = screen.getAllByRole('button', { name: '模拟支付' })[0];
    const cancel = screen.getAllByRole('button', { name: '取消订单' })[0];

    clickTogether(pay, pay, cancel);
    expect(mutations).toEqual([['pay', 1]]);
    expect(confirm, 'a click while an action is pending must not prompt').not.toHaveBeenCalled();
    await settle();
    for (const action of actionButtons()) expect(action).toBeDisabled();
    expect(requests()).toHaveLength(1);

    await act(async () => payment.resolve({}));
    await settle();
    expect(requests()).toHaveLength(2);
    expect(notifications).toEqual(['模拟支付完成，未实际扣款']);
  });

  it('returns to the remaining last page after cancelling the only order on the final filtered page', async () => {
    let cancelled = false;
    const { commits } = await setup({ search: '?status=0', cancel: async () => { cancelled = true; }, list: async params => {
      const total = cancelled ? 10 : 11;
      const rows = Array.from({ length: params.page === 1 ? 10 : cancelled ? 0 : 1 }, (_, index) => order((params.page - 1) * 10 + index + 1));
      return { orders: rows, total, page: params.page, limit: 10, totalPages: Math.ceil(total / 10) };
    } });
    await click(button('下一页'));
    expect(displayedOrders()).toEqual(['ORDER-11']);

    await click(button('取消订单'));

    expect(requests().slice(-2)).toEqual([{ page: 2, limit: 10, status: 0 }, { page: 1, limit: 10, status: 0 }]);
    expect(displayedOrders()).toHaveLength(10);
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
    expect(commits.filter(commit => within(commit).queryByText('暂无订单')), 'the emptied page must not flash').toEqual([]);
  });

  describe.each(['pay', 'cancel', 'confirm'] as const)('a stale %s handler', (action) => {
    const ordersFor = async () => page([order(1, action === 'confirm' ? 2 : 0)], 1, 1);

    it('sends nothing and asks nothing after the filter changes', async () => {
      const confirm = vi.fn(() => true);
      await setup({ list: ordersFor, confirm });
      const staleAction = captureHandler(button(actionLabel[action]));
      await click(button('已取消'));

      await staleAction();
      expect(mutations).toEqual([]);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('sends nothing after another tab changes the token', async () => {
      await setup({ list: ordersFor });
      localStorage.setItem('session', 'other-tab-session');

      await click(button(actionLabel[action]));
      expect(mutations).toEqual([]);
    });
  });

  const lateMutationCases = (['pay', 'cancel', 'confirm'] as const).flatMap(action =>
    (['account', 'storage', 'unmount'] as const).flatMap(change =>
      (['success', 'failure'] as const).map(outcome => ({ action, change, outcome }))));

  it.each(lateMutationCases)('ignores a late $action $outcome after a $change change: no refresh, notice or cart change', async ({ action, change, outcome }) => {
    const pending = deferred();
    const { view } = await setup({ pay: () => pending.promise, cancel: () => pending.promise, confirmOrder: () => pending.promise,
      list: async () => page([order(1, action === 'confirm' ? 2 : 0)], 1, 1) });
    fireEvent.click(button(actionLabel[action]));
    // Cancelling awaits the confirmation first; the change must come while the request is in flight.
    await act(async () => { await Promise.resolve(); });
    expect(mutations, 'the request is in flight before the change').toHaveLength(1);

    if (change === 'account') {
      act(() => useAuthStore.getState().login(secondUser, 'second-session'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('session', 'other-tab-session');
    if (change === 'unmount') view.unmount();
    useCartStore.getState().setItems([{ cart_id: 1, product_id: 1, title: 'Current cart', quantity: 2, price: 10, stock: 4 }]);
    const lists = requests().length;

    await act(async () => {
      if (outcome === 'success') pending.resolve({});
      else pending.reject(apiError('旧操作失败'));
    });
    await settle();

    expect(requests()).toHaveLength(lists);
    expect(notifications).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
    expect(useCartStore.getState().getTotalCount()).toBe(2);
  });

  it('lets the next customer act while the previous customer\'s payment is still pending', async () => {
    const payment = deferred();
    let calls = 0;
    await setup({ pay: () => ++calls === 1 ? payment.promise : Promise.resolve({}), list: async () => page([order(1)], 1, 1) });
    fireEvent.click(button('模拟支付'));

    act(() => useAuthStore.getState().login(secondUser, 'second-session'));
    await settle();
    await click(button('模拟支付'));
    expect(mutations).toEqual([['pay', 1], ['pay', 1]]);
    expect(notifications).toEqual(['模拟支付完成，未实际扣款']);
  });

  it.each(['filter', 'page'] as const)('refreshes the current query when a mutation finishes after a %s change, without restoring the old scope', async (change) => {
    const payment = deferred();
    await setup({ pay: () => payment.promise,
      list: async params => page([order(params.page, params.status ?? 0, `${params.status === 4 ? 'CANCELLED' : 'ALL'}-PAGE${params.page}`)], 13, 2) });
    fireEvent.click(button('模拟支付'));
    await click(button(change === 'filter' ? '已取消' : '下一页'));
    const expected = change === 'filter' ? { page: 1, limit: 10, status: 4 } : { page: 2, limit: 10 };
    expect(requests().at(-1)).toEqual(expected);

    await act(async () => payment.resolve({}));
    await settle();

    expect(requests().at(-1)).toEqual(expected);
    expect(requests()).toHaveLength(3);
    expect(displayedOrders()).toEqual([change === 'filter' ? 'CANCELLED-PAGE1-1' : 'ALL-PAGE2-2']);
  });

  it.each(['decline', 'account'] as const)('checks cancellation before and after the prompt and sends nothing (%s)', async (change) => {
    await setup({ confirm: () => {
      if (change === 'account') useAuthStore.getState().login(secondUser, 'second-session');
      return change !== 'decline';
    } });
    await click(screen.getAllByRole('button', { name: '取消订单' })[0]);
    expect(mutations).toEqual([]);
  });

  const lateListCases = (['unmount', 'storage'] as const).flatMap(change =>
    (['success', 'failure'] as const).map(outcome => ({ change, outcome })));

  it.each(lateListCases)('never shows or reports a late list $outcome after $change', async ({ change, outcome }) => {
    const pending = deferred<OrderList>();
    const { view } = await setup({ list: () => pending.promise });
    if (change === 'unmount') view.unmount();
    else localStorage.setItem('session', 'other-tab-session');

    await act(async () => {
      if (outcome === 'success') pending.resolve(page([order(99, 0, 'LATE')], 1, 1));
      else pending.reject(apiError('旧列表错误'));
    });
    await settle();

    expect(notifications).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    if (change === 'storage') {
      expect(displayedOrders()).toEqual([]);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  });

  it('keeps the orders after a failed payment, reports the server error and allows a retry', async () => {
    let fail = true;
    await setup({ pay: async () => { if (fail) throw apiError('订单已过期'); } });

    await click(screen.getAllByRole('button', { name: '模拟支付' })[0]);
    expect(notifications).toContain('订单已过期');
    expect(requests()).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '模拟支付' })[0]).toBeEnabled();
    expect(displayedOrders()).toHaveLength(10);

    fail = false;
    await click(screen.getAllByRole('button', { name: '模拟支付' })[0]);
    expect(requests()).toHaveLength(2);
  });

  it('offers pay and cancel only for unpaid orders and confirmation only for shipped ones', async () => {
    await setup({ list: async () => page([0, 1, 2, 3, 4].map(status => order(status + 1, status)), 5, 1) });

    expect(actionButtons().map(element => element.textContent)).toEqual(['模拟支付', '取消订单', '确认收货']);
    await click(actionButtons()[2]);
    expect(mutations).toEqual([['confirm', 3]]);
  });
});
