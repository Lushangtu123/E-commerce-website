import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/orders/page';
import OrderDetailPage from '@/app/orders/[id]/page';
import { orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notices = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1' }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: (value: string) => notices.push(value), success: (value: string) => notices.push(value) } }));
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn(async () => ({ mode: 'demo', canPay: true, isDemo: true })) },
  orderApi: { list: vi.fn(), getDetail: vi.fn(), pay: vi.fn(), cancel: vi.fn(), confirm: vi.fn() },
  orderTimeoutApi: { getRemainingTime: vi.fn(async () => ({ remaining_minutes: 10 })) },
}));
vi.mock('@/components/OrderReviews', () => ({ default: () => null }));
vi.mock('@/components/OrderAfterSales', () => ({ default: () => null }));

const order = { order_id: 1, order_no: 'ORDER-1', status: 0, total_amount: '50.00', created_at: '2026-10-08T00:00:00Z' };
const item = { item_id: 1, order_id: 1, product_id: 2, product_name: 'Shirt', price: '25.00', quantity: 2 };
const snapshot = { order, items: [item] };
const list = { orders: [order], page: 1, limit: 10, total: 1, totalPages: 1 };
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const invalidDetails = [
  { label: 'null item', value: { order: { ...order, status: 4 }, items: [null] } },
  { label: 'foreign item', value: { order: { ...order, status: 4 }, items: [{ ...item, order_id: 2 }] } },
  { label: 'missing items', value: { order: { ...order, status: 4 } } },
  { label: 'missing total', value: { order: { ...order, total_amount: undefined, status: 4 }, items: [] } },
  { label: 'error envelope', value: { order: { ...order, status: 4 }, items: [], error: 'failed' } },
  { label: 'malformed address', value: { order: { ...order, status: 4, shipping_address_snapshot: { receiver_name: {}, phone: '123' } }, items: [] } },
];

function signIn() {
  notices.length = 0;
  useAuthStore.getState().login({ user_id: 1, username: 'buyer', email: 'buyer@example.test' }, 'A');
  vi.stubGlobal('confirm', () => true);
}

describe('customer order read publication', () => {
  it.each(invalidDetails)('rejects $label on first detail load and retries only the read', async ({ value }) => {
    signIn();
    vi.mocked(orderApi.getDetail).mockResolvedValueOnce(value as never).mockResolvedValue(snapshot as never);
    render(<OrderDetailPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单详情失败，请重试');
    expect(screen.queryByText('ORDER-1')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('NaN');
    expect(router.push).not.toHaveBeenCalled();
    clickTogether(button('重新加载'), button('重新加载')); await settle();
    expect(screen.getByText('ORDER-1')).toBeInTheDocument();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(2);
    expect(orderApi.cancel).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'error envelope', value: { ...list, error: 'failed' } },
    { label: 'explicit failure', value: { ...list, success: false } },
    { label: 'missing total', value: { ...list, total: undefined } },
    { label: 'wrong page', value: { ...list, page: 2 } },
    { label: 'wrong limit', value: { ...list, limit: 20 } },
    { label: 'wrong total pages', value: { ...list, totalPages: 4 } },
    { label: 'negative total', value: { ...list, total: -1 } },
    { label: 'oversized page', value: { ...list, orders: Array.from({ length: 11 }, (_, index) => ({ ...order, order_id: index + 1, order_no: `ORDER-${index + 1}` })), total: 11, totalPages: 2 } },
    { label: 'duplicate order', value: { ...list, orders: [order, order], total: 2 } },
    { label: 'invalid order money', value: { ...list, orders: [{ ...order, total_amount: {} }] } },
    { label: 'invalid order number', value: { ...list, orders: [{ ...order, order_no: {} }] } },
  ])('rejects $label before publishing a list and permits a read retry', async ({ value }) => {
    signIn(); vi.mocked(orderApi.list).mockResolvedValueOnce(value as never).mockResolvedValue(list as never);
    render(<OrdersPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单失败，请重试');
    expect(screen.queryByText('订单号: ORDER-1')).not.toBeInTheDocument();
    clickTogether(button('重新加载'), button('重新加载')); await settle();
    expect(screen.getByText('订单号: ORDER-1')).toBeInTheDocument();
    expect(orderApi.list).toHaveBeenCalledTimes(2);
  });

  it('rejects a list from a different status filter', async () => {
    signIn(); window.history.replaceState(null, '', '/orders?status=4');
    vi.mocked(orderApi.list).mockResolvedValue(list as never);
    render(<OrdersPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单失败，请重试');
    expect(screen.queryByText('订单号: ORDER-1')).not.toBeInTheDocument();
  });

  it('publishes a newly inserted order after an earlier COUNT returned zero', async () => {
    signIn();
    vi.mocked(orderApi.list).mockResolvedValue({ ...list, total: 0, totalPages: 0 } as never);
    render(<OrdersPage />); await settle();
    expect(screen.getByText('订单号: ORDER-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(button('取消订单')).toBeEnabled();
  });

  it('publishes both rows on page two after insertion between COUNT and SELECT', async () => {
    signIn();
    vi.mocked(orderApi.list).mockImplementation(async params => ({ ...list, page: (params as { page: number }).page,
      total: 11, totalPages: 2, orders: (params as { page: number }).page === 1 ? [order]
        : [{ ...order, order_id: 11, order_no: 'ORDER-11' }, { ...order, order_id: 12, order_no: 'ORDER-12' }] }));
    render(<OrdersPage />); await settle();
    fireEvent.click(button('下一页')); await settle();
    expect(orderApi.list).toHaveBeenLastCalledWith({ page: 2, limit: 10 });
    expect(screen.getByText('订单号: ORDER-11')).toBeInTheDocument();
    expect(screen.getByText('订单号: ORDER-12')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['detail', 'list'] as const)('keeps %s recovery locked until a full valid detail arrives', async kind => {
    signIn();
    vi.mocked(orderApi.getDetail).mockResolvedValue(snapshot as never);
    vi.mocked(orderApi.list).mockResolvedValue(list as never);
    vi.mocked(orderApi.cancel).mockRejectedValue(new Error('Lost response'));
    render(kind === 'detail' ? <OrderDetailPage /> : <OrdersPage />); await settle();
    for (const { value } of invalidDetails) {
      vi.mocked(orderApi.getDetail).mockResolvedValue(value as never);
      fireEvent.click(button(screen.queryByRole('button', { name: '重新核对订单' }) ? '重新核对订单' : '取消订单'));
      await settle();
      expect(button('重新核对订单')).toBeEnabled();
      expect(button('取消订单')).toBeDisabled();
      expect(button('模拟支付')).toBeDisabled();
      expect(notices).toEqual([]);
      expect(orderApi.cancel).toHaveBeenCalledTimes(1);
      expect(document.body).not.toHaveTextContent('NaN');
    }
    const pending = deferred<typeof snapshot>();
    const before = vi.mocked(orderApi.getDetail).mock.calls.length;
    vi.mocked(orderApi.getDetail).mockReturnValue(pending.promise as never);
    clickTogether(button('重新核对订单'), button('重新核对订单')); await settle();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(before + 1);
    await act(async () => pending.resolve({ ...snapshot, order: { ...order, status: 4 } })); await settle();
    expect(screen.queryByRole('button', { name: '重新核对订单' })).not.toBeInTheDocument();
    expect(notices).toEqual(['已核对，订单状态已更新']);
    expect(orderApi.cancel).toHaveBeenCalledTimes(1);
  });
});
