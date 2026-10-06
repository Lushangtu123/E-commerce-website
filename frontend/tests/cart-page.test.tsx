import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { cartApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { render } from './helpers';

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
