import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const item: CartItem = { cart_id: 1, product_id: 11, quantity: 3, title: 'Recovery item', price: '10.00', stock: 5 };
const failure = (status?: number) => status === undefined ? new AxiosError('Lost reply', 'ERR_NETWORK') : Object.assign(new Error('Uncertain'), { response: { status, data: {} } });

async function prepare({ operation = 'quantity', status, applied = true, read = async (items: CartItem[]) => ({ items }) }: {
  operation?: 'quantity' | 'remove'; status?: number; applied?: boolean;
  read?: (items: CartItem[]) => Promise<unknown>;
} = {}) {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-one');
  let canonical = [structuredClone(item)];
  let gets = 0, writes = 0, orders = 0;
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.url === '/cart' && config.method === 'get') { gets++; data = useAuthStore.getState().user?.user_id === 2 ? { items: [] } : gets === 1 ? { items: structuredClone(canonical) } : await read(structuredClone(canonical)); }
    else if (config.url === '/addresses') data = { addresses: [{ address_id: 1, user_id: 1, receiver_name: 'Buyer', phone: '13800000000', province: 'P', city: 'C', district: 'D', detail_address: 'A', is_default: 1 }] };
    else if (config.url === '/orders/preview') {
      const quantity = JSON.parse(config.data).items.reduce((sum: number, row: CartItem) => sum + row.quantity, 0);
      data = { original_amount: quantity * 10, discount_amount: 0, total_amount: quantity * 10, coupon: null, available_coupons: [] };
    } else if (config.method === 'put' || config.method === 'delete') {
      writes++; if (applied) canonical = operation === 'remove' ? [] : canonical.map(row => ({ ...row, quantity: JSON.parse(config.data).quantity }));
      throw failure(status);
    } else if (config.url === '/orders') { orders++; data = { order_id: 9 }; }
    else throw new Error(`Unexpected ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<CartPage />); await settle();
  return { view, counts: () => ({ gets, writes, orders }), canonical: () => canonical };
}
const increase = () => screen.getByRole('button', { name: '+' });

describe('cart uncertain write recovery', () => {
  it.each([undefined, 408, 429, 500, 409])('rereads committed quantity after status %s and recalculates the quote', async status => {
    const fixture = await prepare({ status });
    fireEvent.click(increase()); await settle();
    expect(fixture.counts()).toMatchObject({ gets: 2, writes: 1 });
    expect(useCartStore.getState().items[0].quantity).toBe(4);
    expect(screen.getByRole('button', { name: '结算 (4)' })).toBeEnabled();
  });
  it('removes a committed deletion after its reply is lost', async () => {
    const fixture = await prepare({ operation: 'remove' });
    fireEvent.click(screen.getByRole('button', { name: '删除' })); await settle();
    expect(fixture.counts()).toMatchObject({ gets: 2, writes: 1 });
    expect(useCartStore.getState().items).toEqual([]);
    expect(screen.getByText('购物车是空的')).toBeInTheDocument();
  });
  it('keeps writes and stale checkout handlers blocked until a read-only retry succeeds', async () => {
    let recover = false;
    const fixture = await prepare({ read: async items => { if (!recover) throw failure(); return { items }; } });
    const oldIncrease = captureHandler(increase());
    const oldCheckout = captureHandler(screen.getByRole('button', { name: '结算 (3)' }));
    fireEvent.click(increase()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认，请重新加载后再操作');
    await oldIncrease(); await oldCheckout(); await settle();
    expect(fixture.counts()).toMatchObject({ writes: 1, orders: 0 });
    recover = true;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
    expect(fixture.counts()).toMatchObject({ gets: 3, writes: 1, orders: 0 });
    expect(screen.getByRole('button', { name: '结算 (4)' })).toBeEnabled();
  });
  it.each([{}, { items: [{ ...item, quantity: '4' }] }, { items: [item, item] }])('rejects a malformed recovery read %j', async response => {
    const fixture = await prepare({ read: async () => response });
    fireEvent.click(increase()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认');
    expect(fixture.counts().writes).toBe(1);
  });
  it('does not select previously unselected rows during recovery', async () => {
    await prepare();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Recovery item' })); await settle();
    fireEvent.click(increase()); await settle();
    expect(useCartStore.getState().items[0].quantity).toBe(4);
    expect(screen.getByRole('checkbox', { name: '选择 Recovery item' })).not.toBeChecked();
  });
  it('keeps canonical quantity when an uncertain write did not apply', async () => {
    await prepare({ applied: false }); fireEvent.click(increase()); await settle();
    expect(useCartStore.getState().items[0].quantity).toBe(3);
    expect(increase()).toBeEnabled();
  });
  it('leaves deterministic validation failures editable without a recovery read', async () => {
    const fixture = await prepare({ status: 400, applied: false }); fireEvent.click(increase()); await settle();
    expect(fixture.counts()).toMatchObject({ gets: 1, writes: 1 }); expect(increase()).toBeEnabled();
  });
  it('ignores a late recovery response after account replacement', async () => {
    const response = deferred<unknown>(); const fixture = await prepare({ read: () => response.promise });
    fireEvent.click(increase()); await settle();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'buyer-two'));
    await settle(); response.resolve({ items: [{ ...item, quantity: 4 }] }); await settle();
    expect(useCartStore.getState().items.some(row => row.quantity === 4)).toBe(false);
    expect(fixture.counts().writes).toBe(1);
  });
  it('translates recovery failures in English', async () => {
    await prepare({ read: async () => { throw failure(); } });
    useLocaleStore.getState().setLocale('en'); await settle();
    fireEvent.click(increase()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The cart update is unconfirmed. Reload your cart before continuing.');
  });
});
