import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/orders/page';
import OrderDetailPage from '@/app/orders/[id]/page';
import { orderApi, paymentApi, type Order } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const route = vi.hoisted(() => ({ id: '1' }));
const notices = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useRouter: () => router, useParams: () => route, useSearchParams: () => {
    const search = useSyncExternalStore(listener => {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    }, () => window.location.search, () => '');
    return new URLSearchParams(search);
  } };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: (message: string) => notices.push(message), success: (message: string) => notices.push(message) } }));
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn(async () => ({ mode: 'demo', canPay: true, isDemo: true })) },
  orderApi: { getDetail: vi.fn(), list: vi.fn(), cancel: vi.fn(), pay: vi.fn(), confirm: vi.fn() },
  orderTimeoutApi: { getRemainingTime: vi.fn(async () => ({ remaining_minutes: 10 })) },
}));
// These have their own write-recovery suites; this suite exercises the parent order controls.
vi.mock('@/components/OrderReviews', () => ({ default: () => null }));
vi.mock('@/components/OrderAfterSales', () => ({ default: () => null }));

type PageKind = 'detail' | 'list';
type ListParams = { page: number; limit: number; status?: number };
const labels = { cancel: '取消订单', pay: '模拟支付', confirm: '确认收货' };
const target = { cancel: 4, pay: 1, confirm: 3 };
const statusLabels = ['待支付', '已支付', '已发货', '已完成', '已取消'];
const buyer = { user_id: 1, username: 'buyer', email: 'buyer@example.test' };
const order = (status = 0, id = 1): Order => ({ order_id: id, order_no: `ORDER-${id}`, status, total_amount: '50.00', created_at: '2026-10-08T00:00:00Z' });
const detail = (status = 0, id = 1) => ({ order: order(status, id), items: [] });
const list = (status = 0, params: ListParams = { page: 1, limit: 10 }) => ({ orders: params.status === undefined || params.status === status ? [order(status)] : [], total: 1, page: params.page, limit: params.limit, totalPages: 1 });
const failure = (status?: number) => Object.assign(new Error('Lost response after commit'), { code: status === undefined ? 'ERR_NETWORK' : undefined, ...(status !== undefined && { response: { status, data: { error: '订单服务暂不可用' } } }) });
const click = async (element: HTMLElement) => { fireEvent.click(element); await settle(); };
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const actionButtons = () => screen.queryAllByRole<HTMLButtonElement>('button', { name: /^(取消订单|模拟支付|确认收货)$/ });
const stateText = (kind: PageKind, status: number) => screen.getByText(statusLabels[status], { selector: kind === 'detail' ? 'div.text-2xl' : 'span.font-medium' });

async function setup(kind: PageKind, initial = 0) {
  useAuthStore.getState().login(buyer, 'session-a');
  vi.stubGlobal('confirm', () => true);
  vi.mocked(orderApi.getDetail).mockResolvedValue(detail(initial));
  vi.mocked(orderApi.list).mockImplementation(async params => list(initial, params as ListParams));
  for (const action of ['cancel', 'pay', 'confirm'] as const) vi.mocked(orderApi[action]).mockResolvedValue({} as never);
  const view = render(kind === 'detail' ? <OrderDetailPage /> : <OrdersPage />);
  await settle();
  return view;
}

beforeEach(() => {
  route.id = '1'; notices.length = 0;
  for (const method of ['pushState', 'replaceState'] as const) {
    const native = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation((...args) => { native(...args); window.dispatchEvent(new PopStateEvent('popstate')); });
  }
});

describe.each(['detail', 'list'] as const)('customer order %s write recovery', kind => {
  it.each((['cancel', 'pay', 'confirm'] as const).flatMap(action => [undefined, 408, 409, 429, 500, 503].map(status => ({ action, status }))))('reads an applied $action after uncertain HTTP $status and never replays it', async ({ action, status }) => {
    const initial = action === 'confirm' ? 2 : 0;
    await setup(kind, initial);
    const actual = target[action];
    vi.mocked(orderApi[action]).mockImplementation(async () => {
      vi.mocked(orderApi.getDetail).mockResolvedValue(detail(actual));
      vi.mocked(orderApi.list).mockImplementation(async params => list(actual, params as ListParams));
      throw failure(status);
    });
    await click(button(labels[action]));
    expect(stateText(kind, actual)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels[action] })).not.toBeInTheDocument();
    expect(orderApi[action]).toHaveBeenCalledTimes(1);
    expect(notices).toContain('已核对，订单状态已更新');
    expect(screen.queryByRole('button', { name: '重新核对订单' })).not.toBeInTheDocument();
  });

  it('keeps the unknown write locked after a failed GET, and retry only reads', async () => {
    await setup(kind);
    vi.mocked(orderApi.cancel).mockRejectedValue(failure());
    vi.mocked(orderApi.getDetail).mockRejectedValue(failure(503));
    await click(button('取消订单'));
    expect(screen.getByRole('alert')).toHaveTextContent('订单更新结果尚未确认，请重新核对订单；确认前不会再次提交');
    actionButtons().forEach(control => expect(control).toBeDisabled());
    const pending = deferred<ReturnType<typeof detail>>();
    vi.mocked(orderApi.getDetail).mockImplementation(() => pending.promise);
    const retry = button('重新核对订单');
    const checks = vi.mocked(orderApi.getDetail).mock.calls.length;
    clickTogether(retry, retry); await settle();
    expect(retry).toBeDisabled();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(checks + 1);
    expect(screen.getByRole('alert')).toHaveTextContent('订单更新结果未知，正在核对实际状态...');
    vi.mocked(orderApi.list).mockImplementation(async params => list(4, params as ListParams));
    await act(async () => pending.resolve(detail(4))); await settle();
    expect(stateText(kind, 4)).toBeInTheDocument();
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { order: { ...order(4), order_id: 99 }, items: [] }, { order: { ...order(4), status: 9 }, items: [] }])('retains the recovery lock for invalid or foreign detail %j', async invalid => {
    await setup(kind);
    vi.mocked(orderApi.cancel).mockRejectedValue(failure());
    vi.mocked(orderApi.getDetail).mockResolvedValue(invalid as never);
    await click(button('取消订单'));
    expect(button('重新核对订单')).toBeEnabled();
    actionButtons().forEach(control => expect(control).toBeDisabled());
    expect(notices).not.toContain('已核对，订单状态已更新');
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh manual submission after reading an unchanged order, without automatic replay', async () => {
    await setup(kind);
    vi.mocked(orderApi.cancel).mockRejectedValueOnce(failure());
    await click(button('取消订单'));
    expect(notices).toContain('已核对，订单尚未更新，请确认信息后重试');
    expect(button('取消订单')).toBeEnabled();
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
    vi.mocked(orderApi.getDetail).mockResolvedValue(detail(4));
    vi.mocked(orderApi.list).mockImplementation(async params => list(4, params as ListParams));
    await click(button('取消订单'));
    expect(orderApi.cancel).toHaveBeenCalledTimes(2);
    expect(stateText(kind, 4)).toBeInTheDocument();
  });

  it.each(['cancel', 'pay', 'confirm'] as const)('keeps normal %s success and known rejection behavior', async action => {
    await setup(kind, action === 'confirm' ? 2 : 0);
    const before = vi.mocked(orderApi.getDetail).mock.calls.length;
    vi.mocked(orderApi[action]).mockRejectedValueOnce({ response: { status: 400, data: { error: '订单状态不允许此操作' } } });
    await click(button(labels[action]));
    expect(notices).toEqual(['订单状态不允许此操作']);
    expect(orderApi.getDetail).toHaveBeenCalledTimes(before);
    expect(button(labels[action])).toBeEnabled();
    vi.mocked(orderApi.getDetail).mockResolvedValue(detail(target[action]));
    vi.mocked(orderApi.list).mockImplementation(async params => list(target[action], params as ListParams));
    await click(button(labels[action]));
    expect(stateText(kind, target[action])).toBeInTheDocument();
    expect(orderApi[action]).toHaveBeenCalledTimes(2);
  });

  it('does not expose simulated payment when production payment is disabled', async () => {
    vi.mocked(paymentApi.getSettings).mockResolvedValue({ mode: 'disabled', canPay: false, isDemo: false });
    await setup(kind);
    expect(screen.queryByRole('button', { name: '模拟支付' })).not.toBeInTheDocument();
    expect(button('取消订单')).toBeEnabled();
  });

  it.each(['storage', 'account', 'unmount'] as const)('ignores a pending write that loses its %s session', async change => {
    const view = await setup(kind);
    const pending = deferred(); vi.mocked(orderApi.cancel).mockImplementation(() => pending.promise as never);
    fireEvent.click(button('取消订单')); await settle();
    if (change === 'storage') localStorage.setItem('session', 'session-b');
    if (change === 'account') { act(() => useAuthStore.getState().login({ ...buyer, user_id: 2 }, 'session-b')); await settle(); }
    if (change === 'unmount') view.unmount();
    const checks = vi.mocked(orderApi.getDetail).mock.calls.length;
    const lists = vi.mocked(orderApi.list).mock.calls.length;
    await act(async () => pending.reject(failure())); await settle();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(checks);
    expect(orderApi.list).toHaveBeenCalledTimes(lists);
    expect(notices).toEqual([]);
  });

  it.each(['storage', 'account', 'unmount'] as const)('ignores a recovery GET that loses its %s session', async change => {
    const view = await setup(kind);
    const pending = deferred<ReturnType<typeof detail>>();
    vi.mocked(orderApi.cancel).mockRejectedValue(failure());
    vi.mocked(orderApi.getDetail).mockImplementation(() => pending.promise);
    fireEvent.click(button('取消订单')); await settle();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(kind === 'detail' ? 2 : 1);
    if (change === 'storage') localStorage.setItem('session', 'session-b');
    if (change === 'account') {
      vi.mocked(orderApi.getDetail).mockResolvedValue(detail(0, 2));
      act(() => useAuthStore.getState().login({ ...buyer, user_id: 2 }, 'session-b')); await settle();
    }
    if (change === 'unmount') view.unmount();
    const lists = vi.mocked(orderApi.list).mock.calls.length;
    await act(async () => pending.resolve(detail(4))); await settle();
    expect(orderApi.list).toHaveBeenCalledTimes(lists);
    expect(notices).toEqual([]);
  });
});

describe('customer order list recovery across views', () => {
  it.each(['filter', 'page'] as const)('refreshes the current %s after recovery while ignoring an older read', async change => {
    const write = deferred(), oldRead = deferred<ReturnType<typeof list>>();
    await setup('list');
    let changedReads = 0;
    vi.mocked(orderApi.list).mockImplementation(async raw => {
      const params = raw as ListParams;
      if (params.status === 4 || params.page === 2) {
        if (++changedReads === 1) return oldRead.promise;
        return { ...list(4, params), orders: [order(4, 2)], total: 20, totalPages: 2 };
      }
      return { ...list(0, params), total: 20, totalPages: 2 };
    });
    // Refresh once to make page two available.
    await click(button('已支付')); await click(button('全部'));
    vi.mocked(orderApi.cancel).mockImplementation(() => write.promise as never);
    fireEvent.click(button('取消订单')); await settle();
    await click(button(change === 'filter' ? '已取消' : '下一页'));
    vi.mocked(orderApi.getDetail).mockResolvedValue(detail(4));
    await act(async () => write.reject(failure())); await settle();
    expect(orderApi.list).toHaveBeenLastCalledWith({ page: change === 'page' ? 2 : 1, limit: 10, ...(change === 'filter' && { status: 4 }) });
    await act(async () => oldRead.resolve({ ...list(0), total: 20, totalPages: 2 })); await settle();
    expect(screen.getByText('订单号: ORDER-2')).toBeInTheDocument();
    expect(screen.queryByText('订单号: ORDER-1')).not.toBeInTheDocument();
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not restore stale unpaid rows after a successful detail check', async () => {
    await setup('list');
    vi.mocked(orderApi.cancel).mockRejectedValue(failure());
    vi.mocked(orderApi.getDetail).mockResolvedValue(detail(4));
    // A lagging list must not override the detail just checked.
    await click(button('取消订单'));
    expect(stateText('list', 4)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消订单' })).not.toBeInTheDocument();
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a recovery across a filter change and blocks a stale retry after storage changes', async () => {
    await setup('list');
    vi.mocked(orderApi.cancel).mockRejectedValue(failure());
    vi.mocked(orderApi.getDetail).mockRejectedValue(failure(503));
    await click(button('取消订单'));
    await click(button('已取消'));
    expect(button('重新核对订单')).toBeEnabled();
    localStorage.setItem('session', 'session-b');
    const checks = vi.mocked(orderApi.getDetail).mock.calls.length;
    await click(button('重新核对订单'));
    expect(orderApi.getDetail).toHaveBeenCalledTimes(checks);
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });
});
