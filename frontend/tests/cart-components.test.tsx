import { fireEvent, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CartItemRow from '@/components/CartItemRow';
import CheckoutSummary from '@/components/CheckoutSummary';
import type { OrderPreview } from '@/lib/api';
import type { CartItem } from '@/store/useCartStore';
import { render } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const item: CartItem = { cart_id: 1, product_id: 7, quantity: 2, title: 'Lamp', price: '12.50', stock: 5 };

function renderRow(props: Partial<ComponentProps<typeof CartItemRow>> = {}) {
  const handlers = { onToggle: vi.fn(), onQuantityChange: vi.fn(), onRemove: vi.fn() };
  render(<CartItemRow item={item} selected submitting={false} {...handlers} {...props} />);
  return handlers;
}

const minus = () => screen.getByRole('button', { name: '-' });
const plus = () => screen.getByRole('button', { name: '+' });
const checkbox = () => screen.getByRole('checkbox', { name: '选择 Lamp' });

describe('cart item row', () => {
  it('shows the line subtotal and steps the quantity within stock', () => {
    const { onQuantityChange, onRemove, onToggle } = renderRow();
    expect(screen.getByText('¥25.00')).toBeInTheDocument();
    expect(checkbox()).toBeChecked();

    fireEvent.click(plus());
    fireEvent.click(minus());
    fireEvent.click(checkbox());
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onQuantityChange.mock.calls).toEqual([[3], [1]]);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('stops adding at the stock limit', () => {
    renderRow({ item: { ...item, quantity: 5 } });
    expect(plus()).toBeDisabled();
    expect(minus()).toBeEnabled();
  });

  it('lowers an over-stock line straight to the remaining stock', () => {
    const { onQuantityChange } = renderRow({ item: { ...item, quantity: 6, stock: 2, available: false, unavailable_reason: '库存不足' } });
    expect(plus()).toBeDisabled();
    fireEvent.click(minus());
    expect(onQuantityChange.mock.calls).toEqual([[2]]);
  });

  it('cannot select an unavailable line and links back to choose its options again', () => {
    renderRow({ item: { ...item, available: 0, unavailable_reason: '规格已下架' } });
    expect(checkbox()).not.toBeChecked();
    expect(checkbox()).toBeDisabled();
    expect(minus()).toBeDisabled();
    expect(screen.getByText('规格已下架')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新选规格' }));
    expect(router.push).toHaveBeenCalledWith('/products/7');
  });

  it('locks every control while an order is being submitted', () => {
    renderRow({ submitting: true });
    for (const control of [checkbox(), plus(), minus(), screen.getByRole('button', { name: '删除' })]) expect(control).toBeDisabled();
  });
});

const quote: OrderPreview = {
  original_amount: 100, discount_amount: 15, total_amount: 85, coupon: null,
  available_coupons: [{ user_coupon_id: 9, name: 'Save', code: 'SAVE', discount_amount: 15 }],
};
const address = { address_id: 3, receiver_name: 'Ada', phone: '13800000000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '1 号' };

function renderSummary(props: Partial<ComponentProps<typeof CheckoutSummary>> = {}) {
  const handlers = { onSelectAddress: vi.fn(), onReloadAddresses: vi.fn(), onRetryQuote: vi.fn(), onSelectCoupon: vi.fn(), onCheckout: vi.fn() };
  render(<CheckoutSummary itemCount={2} submitting={false} addresses={[address]} addressLoading={false} addressError={null}
    selectedAddressId={3} quote={quote} quoteLoading={false} quoteError={null} selectedCouponId={undefined} {...handlers} {...props} />);
  return handlers;
}

const checkoutButton = () => screen.getByRole('button', { name: /结算|提交中/ });

describe('checkout summary', () => {
  it('shows the server totals and checks out with a selected address', () => {
    const { onCheckout, onSelectAddress, onSelectCoupon } = renderSummary();
    expect(screen.getByText('¥100.00')).toBeInTheDocument();
    expect(screen.getByText('-¥15.00')).toBeInTheDocument();
    expect(screen.getByText('¥85.00')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('收货地址'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('优惠券'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('优惠券'), { target: { value: '' } });
    fireEvent.click(checkoutButton());
    expect(onSelectAddress).toHaveBeenCalledWith(3);
    expect(onSelectCoupon.mock.calls).toEqual([[9], [undefined]]);
    expect(onCheckout).toHaveBeenCalledOnce();
  });

  it.each([
    ['no items', { itemCount: 0 }],
    ['a pending quote', { quote: null, quoteLoading: true }],
    ['a failed quote', { quoteError: '报价失败' }],
    ['loading addresses', { addressLoading: true }],
    ['a failed address load', { addressError: '地址加载失败' }],
    ['no selected address', { selectedAddressId: undefined }],
  ])('cannot check out with %s', (_, props) => {
    renderSummary(props);
    expect(checkoutButton()).toBeDisabled();
  });

  it('locks the address and coupon choices while submitting', () => {
    renderSummary({ submitting: true });
    expect(screen.getByLabelText('收货地址')).toBeDisabled();
    expect(screen.getByLabelText('优惠券')).toBeDisabled();
    expect(checkoutButton()).toHaveTextContent('提交中...');
    expect(checkoutButton()).toBeDisabled();
  });

  it('offers retries for a failed address load and a failed quote', () => {
    const { onReloadAddresses, onRetryQuote } = renderSummary({ addressError: '地址加载失败', quoteError: '报价失败' });
    fireEvent.click(screen.getByRole('button', { name: '重新加载地址' }));
    fireEvent.click(screen.getByRole('button', { name: '重新计算' }));
    expect(onReloadAddresses).toHaveBeenCalledOnce();
    expect(onRetryQuote).toHaveBeenCalledOnce();
  });
});
