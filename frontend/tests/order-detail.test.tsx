import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrderDetailPage from '@/app/orders/[id]/page';
import OrderReviews from '@/components/OrderReviews';
import { orderApi, type Order, type OrderItem } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { deferred, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '1' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn(async () => ({ mode: 'demo', canPay: true, isDemo: true })) },
  orderApi: { getDetail: vi.fn(), pay: vi.fn() },
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
    localStorage.setItem('token', 'B');

    fireEvent.click(screen.getByRole('button', { name: '模拟支付' }));
    await settle();

    expect(orderApi.pay).not.toHaveBeenCalled();
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
