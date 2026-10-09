import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { quickAddToCart } from '@/lib/quick-cart';
import { retryCartAdd } from '@/lib/cart-add';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { deferred, settle } from './helpers';

const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const signIn = (id = 1) => useAuthStore.getState().login({ user_id: id, username: 'Buyer', email: 'buyer@test' }, `buyer-${id}`);
const row: CartItem = { cart_id: 7, product_id: 1, quantity: 4, title: 'Item', price: '10.00', stock: 20 };
const failure = (status?: number) => status === undefined ? new AxiosError('Lost reply', 'ERR_NETWORK') : Object.assign(new Error('Rejected'), { response: { status, data: { error: '商品库存不足' } } });
function server({ fail, read = async () => ({ items: [row] }), post = async () => {}, receipt }: { fail?: number | 'network'; read?: () => Promise<unknown>; post?: () => Promise<void>; receipt?: (key: unknown) => unknown } = {}) {
  const writes: Record<string, unknown>[] = []; let gets = 0;
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.url?.startsWith('/products/')) data = { product: { product_id: 1, title: 'Item', price: 10, stock: 20, has_sku: false } };
    else if (config.url === '/cart' && config.method === 'get') { gets++; data = await read(); }
    else if (config.url === '/cart' && config.method === 'post') {
      writes.push(JSON.parse(config.data)); await post();
      if (fail !== undefined) throw failure(fail === 'network' ? undefined : fail);
      data = receipt ? receipt(writes.at(-1)?.add_key) : { message: '添加成功', add_key: writes.at(-1)?.add_key, replayed: false };
    } else throw new Error(`Unexpected ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  return { writes, gets: () => gets };
}
const storedIntent = () => JSON.parse(sessionStorage.getItem('pending-cart-add:buyer-1:1') || 'null');

describe('shared additive cart recovery', () => {
  it('persists a UUID and exact input before POST, then replaces stale local quantity with the canonical cart', async () => {
    signIn(); useCartStore.getState().setItems([{ ...row, quantity: 1 }]);
    const fixture = server({ post: async () => {
      expect(storedIntent()).toMatchObject({ key: expect.stringMatching(/^[a-f0-9-]{36}$/), input: { product_id: 1, quantity: 1 } });
    } });
    expect(await quickAddToCart(1)).toBe('added');
    expect(fixture.writes[0].add_key).toMatch(/^[a-f0-9-]{36}$/);
    expect(useCartStore.getState().items).toEqual([row]); expect(fixture.gets()).toBe(1); expect(storedIntent()).toBeNull();
  });
  it.each(['network', 408, 409, 429, 500] as const)('keeps an uncertain add after %s and blocks fresh adds from competing entry points', async fail => {
    signIn(); const fixture = server({ fail });
    await expect(quickAddToCart(1)).rejects.toThrow();
    expect(storedIntent()).toMatchObject({ input: { product_id: 1, quantity: 1 } });
    await expect(quickAddToCart(2)).rejects.toThrow('请先重试未确认的购物车添加');
    expect(fixture.writes).toHaveLength(1); expect(fixture.gets()).toBe(0);
  });
  it('leaves deterministic 400 failures editable with a fresh UUID', async () => {
    signIn(); const fixture = server({ fail: 400 });
    await expect(quickAddToCart(1)).rejects.toThrow(); await expect(quickAddToCart(1)).rejects.toThrow();
    expect(fixture.writes).toHaveLength(2); expect(fixture.writes[0].add_key).not.toBe(fixture.writes[1].add_key); expect(storedIntent()).toBeNull();
  });
  it('blocks POST when retry identity cannot be stored or parsed', async () => {
    signIn(); const fixture = server(); sessionStorage.setItem('pending-cart-add:buyer-1:1', '{broken');
    await expect(quickAddToCart(1)).rejects.toThrow('无法保存购物车添加请求'); expect(fixture.writes).toHaveLength(0);
    sessionStorage.clear(); vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    await expect(quickAddToCart(1)).rejects.toThrow('无法保存购物车添加请求'); expect(fixture.writes).toHaveLength(0);
  });
  it('serializes different add entry points for the same account before their POST', async () => {
    signIn(); const pending = deferred<void>(); const fixture = server({ post: () => pending.promise });
    const first = quickAddToCart(1); await settle();
    const second = quickAddToCart(2).catch(error => error); await settle();
    try { expect(fixture.writes).toHaveLength(1); }
    finally { pending.resolve(); await Promise.all([first, second]); }
  });
  it('retains an acknowledged add when its canonical read fails, without optimistic cart changes', async () => {
    signIn(); server({ read: async () => { throw failure(); } });
    await expect(quickAddToCart(1)).rejects.toThrow();
    expect(storedIntent()).not.toBeNull(); expect(useCartStore.getState().items).toEqual([]);
  });
  it.each([{}, { items: [{ ...row, quantity: '4' }] }, { items: [row, row] }])('keeps the exact intent when the canonical cart is malformed: %j', async response => {
    signIn(); const fixture = server({ read: async () => response });
    await expect(quickAddToCart(1)).rejects.toThrow('结果尚未确认'); const original = storedIntent();
    await expect(quickAddToCart(2)).rejects.toThrow('请先重试');
    expect(storedIntent()).toEqual(original); expect(fixture.writes).toHaveLength(1); expect(useCartStore.getState().items).toEqual([]);
  });
  it.each([() => ({}), () => ({ add_key: 'other', replayed: true }), (add_key: unknown) => ({ add_key, replayed: 'yes' })])('requires the matching key and boolean replay flag before reading or clearing the cart', async receipt => {
    signIn(); const fixture = server({ receipt }); await expect(quickAddToCart(1)).rejects.toThrow('结果尚未确认');
    expect(fixture.gets()).toBe(0); expect(storedIntent()).not.toBeNull();
  });
  it('an explicit retry after navigation uses the original key and canonical empty cart after removal', async () => {
    signIn(); const first = server({ fail: 'network' }); await expect(quickAddToCart(1)).rejects.toThrow();
    const retry = server({ read: async () => ({ items: [] }) });
    expect(await retryCartAdd()).toBe(true); expect(retry.writes).toEqual(first.writes);
    expect(storedIntent()).toBeNull(); expect(useCartStore.getState().items).toEqual([]);
  });
  it.each(['account', 'storage', 'unmount'])('ignores a late canonical add read after %s and retains its retry identity', async change => {
    signIn(); const response = deferred<unknown>(); server({ read: () => response.promise }); let active = true;
    const operation = quickAddToCart(1, () => active); await settle();
    if (change === 'account') signIn(2); if (change === 'storage') localStorage.setItem('session', 'buyer-2'); if (change === 'unmount') active = false;
    response.resolve({ items: [row] }); expect(await operation).toBeNull();
    expect(useCartStore.getState().items).toEqual([]); expect(storedIntent()).not.toBeNull();
  });
});
