import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { cartApi, orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  cartApi: { list: vi.fn() },
  addressApi: { list: vi.fn(async () => ({ addresses: [] })) },
  orderApi: { preview: vi.fn(async () => ({ original_amount: 0, discount_amount: 0, total_amount: 0, coupon: null, available_coupons: [] })) },
}));

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const firstItem: CartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'First customer product', price: 10, stock: 5 };
const secondItem: CartItem = { ...firstItem, product_id: 22, title: 'Second customer product' };

const list = vi.mocked(cartApi.list);
const cartItems = () => useCartStore.getState().items;
const switchToSecondCustomer = () => act(() => {
  useAuthStore.getState().logout();
  useAuthStore.getState().login(secondUser, 'second-session');
});

describe('cart page', () => {
  it('shows the sum of selected purchasable quantities, not the number of cart rows', async () => {
    list.mockResolvedValue({ items: [firstItem, { ...secondItem, cart_id: 2, quantity: 2 },
      { ...firstItem, cart_id: 3, product_id: 33, title: 'Unavailable', stock: 0, available: false }] });
    render(<CartPage />); await settle();
    expect(screen.getByText('5 件', { exact: true })).toBeVisible();
    act(() => useLocaleStore.setState({ locale: 'en' }));
    expect(screen.getByText('5 items', { exact: true })).toBeVisible();
  });

  beforeEach(() => {
    useAuthStore.getState().login(firstUser, 'first-session');
  });

  it('failed cart loading clears cached items and the header count for the current customer', async () => {
    list.mockRejectedValue(new Error('Unavailable'));
    useCartStore.getState().setItems([firstItem]);

    render(<CartPage />);

    await waitFor(() => expect(cartItems()).toHaveLength(0));
    expect(useCartStore.getState().getTotalCount()).toBe(0);
    expect(screen.queryByText('First customer product')).not.toBeInTheDocument();
    expect(screen.queryByText('购物车是空的')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('加载购物车失败，请重试');
    expect(orderApi.preview).not.toHaveBeenCalled();
  });

  it.each([true, false])('retries a failed cart read and distinguishes a successful empty response (%s)', async empty => {
    const retry = deferred<{ items: CartItem[] }>();
    list.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
    useCartStore.getState().setItems([firstItem]);
    render(<CartPage />);
    await settle();
    const retryRead = captureHandler(screen.getByRole('button', { name: '重新加载' }));

    void retryRead();
    void retryRead();
    await settle();
    expect(list).toHaveBeenCalledTimes(2);
    expect(orderApi.preview).not.toHaveBeenCalled();
    expect(screen.queryByText('购物车是空的')).not.toBeInTheDocument();
    await act(async () => retry.resolve({ items: empty ? [] : [{ ...firstItem, stock: 4 }] }));
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (empty) {
      expect(screen.getByText('购物车是空的')).toBeInTheDocument();
      expect(orderApi.preview).not.toHaveBeenCalled();
    } else {
      expect(screen.getByText('First customer product')).toBeInTheDocument();
      expect(cartItems()[0].stock).toBe(4);
      expect(orderApi.preview).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['success', 'failure'] as const)('ignores a late cart retry %s after switching customers', async outcome => {
    const retry = deferred<{ items: CartItem[] }>();
    list.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ items: [secondItem] });
    render(<CartPage />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    switchToSecondCustomer();
    expect(await screen.findByText('Second customer product')).toBeInTheDocument();

    await act(async () => {
      if (outcome === 'success') retry.resolve({ items: [firstItem] });
      else retry.reject(new Error('Previous customer failed'));
    });
    expect(cartItems()).toEqual([secondItem]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('First customer product')).not.toBeInTheDocument();
  });

  it.each(['storage', 'unmount'] as const)('ignores a late cart retry when %s changes', async change => {
    const retry = deferred<{ items: CartItem[] }>();
    list.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
    const view = render(<CartPage />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    if (change === 'storage') localStorage.setItem('session', 'other-session');
    else view.unmount();

    await act(async () => retry.resolve({ items: [firstItem] }));
    expect(cartItems()).toEqual([]);
    expect(orderApi.preview).not.toHaveBeenCalled();
  });

  it('keeps pending checkout confirmation ahead of a failed cart read', async () => {
    const pending = { sessionKey: JSON.stringify(['first-session', 1]), input: {
      items: [{ product_id: 12, quantity: 1 }], shipping_address_id: 41,
      checkout_key: '11111111-1111-4111-8111-111111111111',
    } };
    sessionStorage.setItem('pending-checkout', JSON.stringify(pending));
    list.mockRejectedValue(new Error('Offline'));
    render(<CartPage />);
    await settle();

    expect(screen.getByRole('heading', { name: '确认订单结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试确认订单' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('pending-checkout')!)).toEqual(pending);
    expect(orderApi.preview).not.toHaveBeenCalled();
  });

  it('switching customers reloads cart even when authentication stays true', async () => {
    list.mockResolvedValueOnce({ items: [firstItem] }).mockResolvedValueOnce({ items: [secondItem] });

    render(<CartPage />);
    expect(await screen.findByText('First customer product')).toBeInTheDocument();

    switchToSecondCustomer();

    expect(await screen.findByText('Second customer product')).toBeInTheDocument();
    expect(screen.queryByText('First customer product')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(cartItems()[0].product_id).toBe(22);
  });

  it.each(['success', 'failure'] as const)(
    "a late %s from the previous customer's request cannot overwrite or clear the new cart",
    async (outcome) => {
      let settleFirst!: { resolve: (value: { items: CartItem[] }) => void; reject: (error: Error) => void };
      list
        .mockReturnValueOnce(new Promise((resolve, reject) => { settleFirst = { resolve, reject }; }))
        .mockResolvedValueOnce({ items: [secondItem] });

      render(<CartPage />);
      switchToSecondCustomer();
      expect(await screen.findByText('Second customer product')).toBeInTheDocument();

      await act(async () => {
        if (outcome === 'success') settleFirst.resolve({ items: [firstItem] });
        else settleFirst.reject(new Error('Previous session failed'));
      });

      expect(cartItems()[0]?.product_id).toBe(22);
      expect(useCartStore.getState().getTotalCount()).toBe(3);
      expect(screen.getByText('Second customer product')).toBeInTheDocument();
      expect(screen.queryByText('First customer product')).not.toBeInTheDocument();
    },
  );
});
