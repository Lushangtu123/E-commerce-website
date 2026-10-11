import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, expect, it } from 'vitest';
import api, { type Product } from '@/lib/api';
import { quickAddToCart } from '@/lib/quick-cart';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

const originalAdapter = api.defaults.adapter;
const product: Product = { product_id: 1, title: 'Item', price: '10.00', stock: 3, sales_count: 0, rating: 0 };
let detail: unknown;
let writes: unknown[];
beforeEach(() => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
  detail = { product }; writes = [];
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get' && config.url === '/products/1') data = detail;
    else if (config.method === 'post' && config.url === '/cart') {
      const body = JSON.parse(config.data); writes.push(body);
      data = { add_key: body.add_key, replayed: false };
    } else if (config.method === 'get' && config.url === '/cart') {
      data = { items: [{ cart_id: 7, product_id: 1, title: product.title, quantity: 1, stock: 3, price: '10.00' }] };
    } else throw new Error(`Unexpected mocked HTTP call ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
});
afterEach(() => { api.defaults.adapter = originalAdapter; });

it('refuses a missing stock snapshot before saving or dispatching an add', async () => {
  detail = { product: { ...product, stock: undefined } };
  await expect(quickAddToCart(1)).rejects.toThrow('加载商品失败，请重试');
  expect(writes).toEqual([]);
  expect(sessionStorage.getItem('pending-cart-add:buyer-session:1')).toBeNull();
});

it('leaves an existing uncertain add identity untouched when a fresh product read is invalid', async () => {
  const key = 'pending-cart-add:buyer-session:1';
  const original = JSON.stringify({ key: '00000000-0000-4000-8000-000000000001', input: { product_id: 1, quantity: 1 } });
  sessionStorage.setItem(key, original); detail = {};
  await expect(quickAddToCart(1)).rejects.toThrow('加载商品失败，请重试');
  expect(writes).toEqual([]); expect(sessionStorage.getItem(key)).toBe(original);
});

it.each([
  null, {}, { product: null }, { product: { ...product, product_id: 2 } },
  { product: { ...product, price: '1e2' } }, { product: { ...product, stock: '3' } },
  { product: { ...product, has_sku: 'false' } }, { product: { ...product, status: 0 } },
  { success: false, product }, { error: 'Failed', product },
  { product: { ...product, has_sku: true, skus: [{ sku_id: 1, product_id: 2, sku_code: 'RED', specs: {}, price: 10, stock: 3, status: 1 }] } },
])('keeps invalid detail %j out of the shared add pipeline', async response => {
  detail = response;
  await expect(quickAddToCart(1)).rejects.toThrow('加载商品失败，请重试');
  expect(writes).toEqual([]); expect(useCartStore.getState().items).toEqual([]);
  expect(sessionStorage.getItem('pending-cart-add:buyer-session:1')).toBeNull();
});

it('adds the valid decimal-string product and reads the canonical cart', async () => {
  expect(await quickAddToCart(1)).toBe('added');
  expect(writes).toEqual([{ product_id: 1, quantity: 1, add_key: expect.any(String) }]);
  expect(useCartStore.getState().items[0]).toMatchObject({ product_id: 1, price: '10.00' });
});

it.each([true, 1])('keeps valid has_sku=%s products on the explicit option-selection path', async has_sku => {
  detail = { product: { ...product, has_sku, skus: [{ sku_id: 1, product_id: 1, sku_code: 'RED', specs: { Color: 'Red' }, price: '10.00', stock: 3, status: 1 }] } };
  expect(await quickAddToCart(1)).toBe('select'); expect(writes).toEqual([]);
});
