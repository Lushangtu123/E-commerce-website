import { expect, it } from 'vitest';
import { useCartStore, type CartItem } from '@/store/useCartStore';

it('cart identities keep base and each SKU separate when adding, updating and removing', () => {
  const store = useCartStore.getState();
  const base: CartItem = { cart_id: 1, product_id: 12, quantity: 1, title: 'Shirt', price: 10, stock: 9 };
  const items = () => useCartStore.getState().items;

  store.addItem(base);
  store.addItem({ ...base, cart_id: 2, sku_id: 101, quantity: 2, price: 20 });
  store.addItem({ ...base, cart_id: 3, sku_id: 102, quantity: 3, price: 30 });
  store.addItem({ ...base, sku_id: 101, quantity: 1, price: 20 });
  expect(items().map(item => [item.sku_id ?? null, item.quantity])).toEqual([[null, 1], [101, 3], [102, 3]]);

  store.updateQuantity(12, 4, 101);
  expect(items().map(item => item.quantity)).toEqual([1, 4, 3]);

  store.removeItem(12, 101);
  expect(items().map(item => item.sku_id ?? null)).toEqual([null, 102]);

  store.updateQuantity(12, 2);
  store.removeItem(12);
  expect(items().map(item => [item.sku_id, item.quantity])).toEqual([[102, 3]]);
  expect(store.getTotalCount()).toBe(3);
  expect(store.getTotalPrice()).toBe(90);
});
