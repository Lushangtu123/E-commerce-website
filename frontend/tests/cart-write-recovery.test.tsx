import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import CartPage from '@/app/cart/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';
import { storePendingCartAdd } from '@/lib/pending-cart-add';
import { retryCartAdd } from '@/lib/cart-add';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const item: CartItem = { cart_id: 1, product_id: 11, quantity: 3, title: 'Recovery item', price: '10.00', stock: 5 };
const failure = (status?: number) => status === undefined ? new AxiosError('Lost reply', 'ERR_NETWORK') : Object.assign(new Error('Uncertain'), { response: { status, data: {} } });

async function prepare({ operation = 'quantity', status, applied = true, reply, read = async (items: CartItem[]) => ({ items }) }: {
  operation?: 'quantity' | 'remove'; status?: number; applied?: boolean;
  reply?: () => Promise<unknown>;
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
    } else if ((config.url === '/cart' && config.method === 'put') || (config.url === '/cart/11' && config.method === 'delete')) {
      writes++;
      if (config.method !== (operation === 'quantity' ? 'put' : 'delete')) throw new Error(`Unexpected cart write ${config.method}`);
      if (applied) canonical = config.method === 'delete' ? [] : canonical.map(row => ({ ...row, quantity: JSON.parse(config.data).quantity }));
      if (reply) data = await reply(); else throw failure(status);
    } else if (config.url === '/orders') { orders++; data = { order_id: 9 }; }
    else throw new Error(`Unexpected ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<CartPage />); await settle();
  return { view, counts: () => ({ gets, writes, orders }), canonical: () => canonical };
}
const increase = () => screen.getByRole('button', { name: '+' });
const writeButton = (operation: 'quantity' | 'remove') => screen.getByRole('button', { name: operation === 'quantity' ? '+' : '删除' });
const acknowledgement = (operation: 'quantity' | 'remove') => ({ message: operation === 'quantity' ? '更新成功' : '删除成功' });

describe.each(['quantity', 'remove'] as const)('cart %s acknowledgement', operation => {
  it.each(['standard', 'nullable error'] as const)('accepts the endpoint’s %s acknowledgement without an extra read', async variant => {
    const response = { ...acknowledgement(operation), ...(variant === 'nullable error' && { success: true, error: null }) };
    const fixture = await prepare({ operation, reply: async () => response });
    fireEvent.click(writeButton(operation)); await settle();
    expect(fixture.counts()).toEqual({ gets: 1, writes: 1, orders: 0 });
    expect(useCartStore.getState()).toMatchObject({ items: fixture.canonical(), syncStatus: 'ready', pendingWrites: 0 });
    if (operation === 'quantity') expect(screen.getByRole('button', { name: '结算 (4)' })).toBeEnabled();
    else {
      expect(screen.getByText('购物车是空的')).toBeVisible();
      expect(toast.success).toHaveBeenCalledWith('已删除');
    }
  });

  const invalidReplies: [string, () => unknown][] = [
    ['missing body', () => undefined],
    ['null body', () => null],
    ['string body', () => '更新成功'],
    ['number body', () => 1],
    ['boolean body', () => true],
    ['array body', () => []],
    ['array with message', () => Object.assign([], acknowledgement(operation))],
    ['missing message', () => ({})],
    ['success without message', () => ({ success: true })],
    ['other endpoint message', () => acknowledgement(operation === 'quantity' ? 'remove' : 'quantity')],
    ['explicit refusal', () => ({ success: false, error: 'upstream failed' })],
    ['negative success', () => ({ ...acknowledgement(operation), success: false })],
    ['error string', () => ({ ...acknowledgement(operation), error: 'upstream failed' })],
    ['empty error', () => ({ ...acknowledgement(operation), error: '' })],
    ['structured error', () => ({ ...acknowledgement(operation), error: { code: 'UNCONFIRMED' } })],
    ['false error', () => ({ ...acknowledgement(operation), error: false })],
    ['zero error', () => ({ ...acknowledgement(operation), error: 0 })],
  ];
  it.each(invalidReplies)('reconciles %s before confirming an unchanged cart', async (_label, response) => {
    const fixture = await prepare({ operation, applied: false, reply: async () => response() });
    fireEvent.click(writeButton(operation)); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1, orders: 0 });
    expect(useCartStore.getState()).toMatchObject({ items: [item], syncStatus: 'ready', pendingWrites: 0 });
    expect(screen.getByRole('heading', { name: item.title })).toBeVisible();
    expect(screen.getByRole('button', { name: '结算 (3)' })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalledWith('已删除');
  });

  it('uses canonical state when an invalid reply follows a committed write', async () => {
    const fixture = await prepare({ operation, reply: async () => ({ success: false, error: 'invalid reply' }) });
    fireEvent.click(writeButton(operation)); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1, orders: 0 });
    expect(useCartStore.getState()).toMatchObject({ items: fixture.canonical(), syncStatus: 'ready', pendingWrites: 0 });
    if (operation === 'quantity') expect(screen.getByRole('button', { name: '结算 (4)' })).toBeEnabled();
    else expect(screen.getByText('购物车是空的')).toBeVisible();
    expect(toast.success).not.toHaveBeenCalledWith('已删除');
  });

  it.each([false, true])('keeps all writes blocked after a failed read and retries only GET (applied: %s)', async applied => {
    let recover = false;
    const fixture = await prepare({ operation, applied, reply: async () => ({}), read: async items => {
      if (!recover) throw failure(); return { items };
    } });
    const staleHandlers = [captureHandler(increase()), captureHandler(screen.getByRole('button', { name: '删除' })),
      captureHandler(screen.getByRole('button', { name: '结算 (3)' })),
      captureHandler(screen.getByRole('checkbox', { name: '选择 Recovery item' }), 'onChange'),
      captureHandler(screen.getByRole('checkbox', { name: '全选' }), 'onChange')];
    fireEvent.click(writeButton(operation)); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认，请重新加载后再操作');
    expect(useCartStore.getState()).toMatchObject({ items: [item], syncStatus: 'error', pendingWrites: 0 });
    for (const handler of staleHandlers) await handler();
    await settle(); expect(fixture.counts()).toEqual({ gets: 2, writes: 1, orders: 0 });
    fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认');
    expect(fixture.counts()).toEqual({ gets: 3, writes: 1, orders: 0 });
    recover = true;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
    expect(fixture.counts()).toEqual({ gets: 4, writes: 1, orders: 0 });
    expect(useCartStore.getState()).toMatchObject({ items: fixture.canonical(), syncStatus: 'ready', pendingWrites: 0 });
    if (operation === 'remove' && applied) expect(screen.getByText('购物车是空的')).toBeVisible();
    else {
      expect(screen.getByRole('checkbox', { name: '选择 Recovery item' })).toBeChecked();
      expect(screen.getByRole('button', { name: `结算 (${applied ? 4 : 3})` })).toBeEnabled();
    }
  });

  it('preserves a deselected row when the invalid reply did not change the cart', async () => {
    const fixture = await prepare({ operation, applied: false, reply: async () => ({}) });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Recovery item' })); await settle();
    fireEvent.click(writeButton(operation)); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1, orders: 0 });
    expect(screen.getByRole('checkbox', { name: '选择 Recovery item' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '结算 (0)' })).toBeDisabled();
  });

  it.each(['account', 'storage'] as const)('ignores a late invalid acknowledgement after the %s session changes', async change => {
    const response = deferred<unknown>();
    const fixture = await prepare({ operation, applied: false, reply: () => response.promise });
    fireEvent.click(writeButton(operation)); await settle();
    if (change === 'account') act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'buyer-two'));
    else localStorage.setItem('session', 'buyer-two');
    await settle();
    const getsBeforeReply = fixture.counts().gets;
    await act(async () => response.resolve({ success: false, error: 'old reply' })); await settle();
    expect(fixture.counts()).toEqual({ gets: getsBeforeReply, writes: 1, orders: 0 });
    expect(useCartStore.getState().items).toEqual(change === 'account' ? [] : [item]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['account', 'storage'] as const)('ignores a late canonical recovery after the %s session changes', async change => {
    const response = deferred<unknown>();
    const fixture = await prepare({ operation, reply: async () => ({}), read: () => response.promise });
    fireEvent.click(writeButton(operation)); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1, orders: 0 });
    if (change === 'account') act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'buyer-two'));
    else localStorage.setItem('session', 'buyer-two');
    await settle();
    await act(async () => response.resolve({ items: fixture.canonical() })); await settle();
    expect(useCartStore.getState().items).toEqual(change === 'account' ? [] : [item]);
    expect(fixture.counts().writes).toBe(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('cart uncertain write recovery', () => {
  it.each(['success', 'failure'])('an older initial cart read %s cannot overwrite a newer acknowledged add read', async outcome => {
    useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-one');
    storePendingCartAdd('buyer-one', 1, { key: '00000000-0000-4000-8000-000000000001', input: { product_id: 11, quantity: 1 } });
    const oldRead = deferred<unknown>(); let reads = 0;
    api.defaults.adapter = async config => {
      let data: unknown;
      if (config.url === '/cart' && config.method === 'get') data = ++reads === 1 ? await oldRead.promise : { items: [{ ...item, quantity: 4 }] };
      else if (config.url === '/cart' && config.method === 'post') data = { add_key: JSON.parse(config.data).add_key, replayed: true };
      else if (config.url === '/addresses') data = { addresses: [] };
      else if (config.url === '/orders/preview') data = { original_amount: 40, total_amount: 40, discount_amount: 0, available_coupons: [], coupon: null };
      else throw new Error(`Unexpected ${config.url}`);
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
    const view = render(<CartPage />); await settle(); await act(async () => { await retryCartAdd(); }); await settle();
    expect(useCartStore.getState().items[0].quantity).toBe(4);
    expect(screen.getByRole('heading', { name: 'Recovery item' })).toBeVisible();
    expect(view.container.querySelector('.animate-pulse')).toBeNull();
    expect(increase()).toBeEnabled();
    act(() => { if (outcome === 'success') oldRead.resolve({ items: [{ ...item, quantity: 3 }] }); else oldRead.reject(failure()); });
    await settle(); expect(useCartStore.getState().items[0]?.quantity).toBe(4);
  });
  it('clears a failed initial cart read after the add has a valid canonical cart', async () => {
    useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-one');
    storePendingCartAdd('buyer-one', 1, { key: '00000000-0000-4000-8000-000000000001', input: { product_id: 11, quantity: 1 } });
    let reads = 0;
    api.defaults.adapter = async config => {
      let data: unknown;
      if (config.url === '/cart' && config.method === 'get') { if (++reads === 1) throw failure(); data = { items: [{ ...item, quantity: 4 }] }; }
      else if (config.url === '/cart' && config.method === 'post') data = { add_key: JSON.parse(config.data).add_key, replayed: true };
      else if (config.url === '/addresses') data = { addresses: [] };
      else if (config.url === '/orders/preview') data = { original_amount: 40, total_amount: 40, discount_amount: 0, available_coupons: [], coupon: null };
      else throw new Error(`Unexpected ${config.url}`);
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
    render(<CartPage />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载购物车失败，请重试');
    await act(async () => { await retryCartAdd(); }); await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovery item' })).toBeVisible(); expect(increase()).toBeEnabled();
  });
  it('blocks rendered controls and stale quantity/checkout handlers while an add awaits canonical reconciliation', async () => {
    const fixture = await prepare();
    const oldIncrease = captureHandler(increase());
    const oldCheckout = captureHandler(screen.getByRole('button', { name: '结算 (3)' }));
    act(() => { storePendingCartAdd('buyer-one', 1, { key: '00000000-0000-4000-8000-000000000001', input: { product_id: 11, quantity: 1 } }); });
    await settle();
    expect(increase()).toBeDisabled(); expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
    await oldIncrease(); await oldCheckout(); await settle();
    expect(fixture.counts()).toMatchObject({ writes: 0, orders: 0 });
  });
  it('a canonical add read preserves a separate unconfirmed quantity write and its recovery lock', async () => {
    await prepare({ read: async () => { throw failure(); } });
    fireEvent.click(increase()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认');
    storePendingCartAdd('buyer-one', 1, { key: '00000000-0000-4000-8000-000000000001', input: { product_id: 11, quantity: 1 } });
    api.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
      data: config.method === 'post' ? { add_key: JSON.parse(config.data).add_key, replayed: true } : { items: [{ ...item, quantity: 4 }] } });
    await act(async () => { await retryCartAdd(); }); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('购物车操作结果尚未确认');
    expect(screen.queryByRole('button', { name: '+' })).not.toBeInTheDocument();
  });
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
