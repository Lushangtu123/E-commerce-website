import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrderDetailPage from '@/app/orders/[id]/page';
import OrderReviews from '@/components/OrderReviews';
import { orderApi, orderTimeoutApi, type Order, type OrderItem } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { clickTogether, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const params = vi.hoisted(() => ({ id: '1' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn(async () => ({ mode: 'demo', canPay: true, isDemo: true })) },
  orderApi: { getDetail: vi.fn(), pay: vi.fn(), cancel: vi.fn(async () => ({})) },
  orderTimeoutApi: { getRemainingTime: vi.fn(async () => ({ remaining_minutes: 10 })) },
}));
// Both sections load their own data and have their own tests; here they only mark where they render.
vi.mock('@/components/OrderReviews', () => ({ default: vi.fn(() => <section>order reviews section</section>) }));
vi.mock('@/components/OrderAfterSales', () => ({ default: vi.fn(() => <section>after-sales section</section>) }));

const customer = { user_id: 1, username: 'buyer', email: 'buyer@example.test' };
const baseOrder: Order = { order_id: 1, order_no: 'ORDER-1', status: 3, total_amount: 50, created_at: '2026-10-02T00:00:00Z' };
const item = (overrides: Partial<OrderItem>): OrderItem =>
  ({ item_id: 1, order_id: 1, product_id: 11, product_name: 'Shirt', price: 20, quantity: 1, ...overrides });

async function setupDetail(order: Partial<Order> & Record<string, unknown>, items: OrderItem[] = []) {
  useAuthStore.getState().login(customer, 'A');
  vi.mocked(orderApi.getDetail).mockResolvedValue({ order: { ...baseOrder, ...order }, items });
  const view = render(<OrderDetailPage />);
  await settle();
  return view;
}

/** The amount row text, e.g. "实付款¥80.00". */
const amountRow = (label: string) => screen.queryByText(label, { selector: 'span' })?.parentElement?.textContent;

describe('order detail', () => {
  it('does not loop detail reloads while a zero countdown waits for automatic cancellation', async () => {
    vi.mocked(orderTimeoutApi.getRemainingTime).mockResolvedValue({ remaining_minutes: 0 } as never);
    await setupDetail({ status: 0 });
    await settle(10);
    expect(orderTimeoutApi.getRemainingTime).toHaveBeenCalledTimes(1);
    expect(orderApi.getDetail).toHaveBeenCalledTimes(2);
  });
  it.each(['zh-CN', 'en'] as const)('keeps a transient failure on the detail page and retries once (%s)', async locale => {
    useLocaleStore.setState({ locale });
    useAuthStore.getState().login(customer, 'A');
    const pending = deferred<Awaited<ReturnType<typeof orderApi.getDetail>>>();
    vi.mocked(orderApi.getDetail).mockRejectedValueOnce({ response: { status: 503 } }).mockReturnValueOnce(pending.promise);
    render(<OrderDetailPage />);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'en'
      ? 'Could not load order details. Please try again' : '加载订单详情失败，请重试');
    const retry = screen.getByRole('button', { name: locale === 'en' ? 'Retry' : '重新加载' });
    clickTogether(retry, retry);
    await settle();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ order: baseOrder, items: [] }));
    await settle();
    expect(screen.getByText('ORDER-1')).toBeInTheDocument();
  });

  it.each([undefined, 408, 429, 500, 503])('does not misreport or navigate away from a recoverable failure (status %s)', async status => {
    useAuthStore.getState().login(customer, 'A');
    vi.mocked(orderApi.getDetail).mockRejectedValue(Object.assign(new Error('failure'), status === undefined ? {} : { response: { status } }));
    render(<OrderDetailPage />);
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单详情失败，请重试');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled();
  });

  it.each([[400, '订单ID无效'], [403, '无权访问该订单'], [404, '订单不存在']] as const)
  ('shows the actual terminal error for status %i and returns to the list', async (status, message) => {
    useAuthStore.getState().login(customer, 'A');
    vi.mocked(orderApi.getDetail).mockRejectedValue({ response: { status, data: { error: message } } });
    const toast = (await import('react-hot-toast')).default;
    const notify = vi.spyOn(toast, 'error');
    render(<OrderDetailPage />);
    await settle();
    expect(router.push).toHaveBeenCalledWith('/orders');
    expect(notify).toHaveBeenCalledWith(message);
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });

  it('leaves sign-in expiry to the API client rather than sending the customer to the list', async () => {
    useAuthStore.getState().login(customer, 'A');
    vi.mocked(orderApi.getDetail).mockRejectedValue({ response: { status: 401 } });
    render(<OrderDetailPage />);
    await settle();
    expect(router.push).not.toHaveBeenCalledWith('/orders');
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)('ignores a late retry %s after the customer changes', async outcome => {
    useAuthStore.getState().login(customer, 'A');
    const pending = deferred<Awaited<ReturnType<typeof orderApi.getDetail>>>();
    vi.mocked(orderApi.getDetail).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ order: { ...baseOrder, order_no: 'B订单' }, items: [] });
    render(<OrderDetailPage />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'b', email: 'b@example.test' }, 'B'));
    await settle();
    expect(screen.getByText('B订单')).toBeInTheDocument();
    await act(async () => outcome === 'success' ? pending.resolve({ order: baseOrder, items: [] }) : pending.reject(new Error('offline')));
    await settle();
    expect(screen.getByText('B订单')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not apply a saved retry handler after another tab changes the session', async () => {
    useAuthStore.getState().login(customer, 'A');
    vi.mocked(orderApi.getDetail).mockRejectedValue(new Error('offline'));
    render(<OrderDetailPage />);
    await settle();
    localStorage.setItem('session', 'B');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(orderApi.getDetail).toHaveBeenCalledTimes(1);
  });

  it.each(['route', 'unmount'] as const)('ignores a retry failure after %s', async change => {
    useAuthStore.getState().login(customer, 'A');
    const pending = deferred<Awaited<ReturnType<typeof orderApi.getDetail>>>();
    vi.mocked(orderApi.getDetail).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ order: { ...baseOrder, order_id: 2, order_no: 'ORDER-2' }, items: [] });
    const view = render(<OrderDetailPage />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    if (change === 'unmount') view.unmount();
    else {
      params.id = '2';
      act(() => view.rerender(<OrderDetailPage />));
      await settle();
    }
    await act(async () => pending.reject({ response: { status: 404 } }));
    await settle();
    expect(router.push).not.toHaveBeenCalled();
    if (change === 'route') expect(screen.getByText('ORDER-2')).toBeInTheDocument();
    params.id = '1';
  });

  it('preserves a loaded order when a later status refresh fails and offers another refresh', async () => {
    await setupDetail({ status: 0 });
    vi.mocked(orderApi.getDetail).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('confirm', () => true);
    fireEvent.click(screen.getByRole('button', { name: '取消订单' }));
    await settle();
    expect(screen.getByText('ORDER-1')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单详情失败，请重试');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '取消订单' })).toBeDisabled();
    vi.mocked(orderApi.getDetail).mockResolvedValue({ order: { ...baseOrder, status: 4 }, items: [] });
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });

  it('renders the original shipping snapshot rather than the current address', async () => {
    const shipping_address_snapshot = { receiver_name: 'Original Receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '旧地址 1 号' };
    await setupDetail({ shipping_address_snapshot, receiver_name: 'Current Address Receiver', detail_address: '新地址' });

    expect(screen.getByText(/Original Receiver/)).toBeInTheDocument();
    expect(screen.getByText('13800138000')).toBeInTheDocument();
    expect(screen.getByText('浙江省杭州市西湖区旧地址 1 号')).toBeInTheDocument();
    expect(screen.queryByText(/Current Address Receiver/)).not.toBeInTheDocument();
  });

  it('identifies legacy orders without a shipping snapshot', async () => {
    await setupDetail({ shipping_address_snapshot: null });
    expect(screen.getByText('历史订单未记录收货信息')).toBeInTheDocument();
  });

  it('shows the purchased SKU snapshot for each variant separately', async () => {
    await setupDetail({}, [
      item({ item_id: 1, price: 20, sku_id: 101, sku_code: 'OLD-RED', sku_specs: { Color: 'Red', Size: 'M' } }),
      item({ item_id: 2, price: 30, sku_id: 102, sku_code: 'OLD-BLUE', sku_specs: { Color: 'Blue', Size: 'L' } }),
    ]);

    expect(screen.getByText('Color: Red / Size: M')).toBeInTheDocument();
    expect(screen.getByText('Color: Blue / Size: L')).toBeInTheDocument();
    expect(screen.getByText(/OLD-RED/)).toBeInTheDocument();
    expect(screen.getByText(/OLD-BLUE/)).toBeInTheDocument();
  });

  it('displays the original price, coupon reduction and charged total separately', async () => {
    await setupDetail({ original_amount: '100.00', discount_amount: '20.00', total_amount: '80.00', user_coupon_id: 7, coupon_name: 'Summer', coupon_code: 'SUMMER' });

    expect(amountRow('商品总价')).toBe('商品总价¥100.00');
    expect(amountRow('优惠券优惠')).toBe('优惠券优惠-¥20.00');
    expect(amountRow('实付款')).toBe('实付款¥80.00');
    expect(amountRow('优惠券')).toBe('优惠券Summer (SUMMER)');
  });

  it('falls back to the total price and a zero coupon reduction for legacy orders', async () => {
    await setupDetail({ original_amount: null, total_amount: '35.00' });

    expect(amountRow('商品总价')).toBe('商品总价¥35.00');
    expect(amountRow('优惠券优惠')).toBe('优惠券优惠-¥0.00');
    expect(amountRow('实付款')).toBe('实付款¥35.00');
  });

  it('labels the final price of an unpaid order as payable instead of already charged', async () => {
    await setupDetail({ status: 0, original_amount: 100, discount_amount: 20, total_amount: 80 });

    expect(amountRow('应付金额')).toBe('应付金额¥80.00');
    expect(amountRow('实付款')).toBeUndefined();
  });

  it('rechecks ownership on a customer change and ignores an earlier detail response', async () => {
    const first = deferred<Awaited<ReturnType<typeof orderApi.getDetail>>>();
    let calls = 0;
    useAuthStore.getState().login(customer, 'A');
    vi.mocked(orderApi.getDetail).mockImplementation(() => ++calls === 1 ? first.promise
      : Promise.resolve({ order: { ...baseOrder, order_no: 'B订单', total_amount: 5 }, items: [] }));
    render(<OrderDetailPage />);
    await settle();

    act(() => useAuthStore.getState().login({ user_id: 2, username: 'b', email: 'b@example.test' }, 'B'));
    await settle();
    expect(calls).toBe(2);
    expect(screen.getByText('B订单')).toBeInTheDocument();

    await act(async () => first.resolve({ order: { ...baseOrder, order_no: 'A订单', total_amount: 100 }, items: [] }));
    await settle();
    expect(screen.getByText('B订单')).toBeInTheDocument();
    expect(screen.queryByText('A订单')).not.toBeInTheDocument();
  });

  it('does not pay for an account another browser tab signed in', async () => {
    await setupDetail({ status: 0, total_amount: 10 });
    localStorage.setItem('session', 'B');

    fireEvent.click(screen.getByRole('button', { name: '模拟支付' }));
    await settle();

    expect(orderApi.pay).not.toHaveBeenCalled();
  });

  it.each([
    ['the customer declines', () => false],
    ['another tab signs in while the question is open', () => { localStorage.setItem('session', 'B'); return true; }],
  ])('does not cancel when %s', async (_, answer) => {
    await setupDetail({ status: 0, total_amount: 10 });
    const confirm = vi.fn(answer);
    vi.stubGlobal('confirm', confirm);

    fireEvent.click(screen.getByRole('button', { name: '取消订单' }));
    await settle();

    expect(confirm).toHaveBeenCalledWith('确定要取消订单吗？');
    expect(orderApi.cancel).not.toHaveBeenCalled();
  });

  it('cancels once the customer confirms', async () => {
    await setupDetail({ status: 0, total_amount: 10 });
    vi.stubGlobal('confirm', () => true);
    fireEvent.click(screen.getByRole('button', { name: '取消订单' }));
    await settle();
    expect(orderApi.cancel).toHaveBeenCalledWith(1);
  });

  it.each([0, 1, 2, 3, 4])('shows the review section only for a completed order (status %i)', async (status) => {
    const items = [item({ item_id: 1, sku_id: 1 }), item({ item_id: 2, sku_id: 2 }), item({ item_id: 3, product_id: 12 })];
    await setupDetail({ status, total_amount: 10 }, items);

    expect(screen.queryAllByText('order reviews section')).toHaveLength(status === 3 ? 1 : 0);
    if (status === 3) expect(vi.mocked(OrderReviews).mock.lastCall?.[0]).toEqual({ orderId: 1, items });
  });

  it('renders the review and after-sales sections of a completed order as distinctly keyed siblings', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await setupDetail({ status: 3, total_amount: 50 });

    expect(screen.getByText('order reviews section')).toBeInTheDocument();
    expect(screen.getByText('after-sales section')).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(/same key/);
  });
});
