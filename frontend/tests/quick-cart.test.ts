import { describe, expect, it, vi } from 'vitest';
import { cartApi, productApi, type Product } from '@/lib/api';
import { quickAddToCart } from '@/lib/quick-cart';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { deferred } from './helpers';

vi.mock('@/lib/api', () => ({ productApi: { getDetail: vi.fn() }, cartApi: { add: vi.fn(async () => ({})) } }));

type Detail = Awaited<ReturnType<typeof productApi.getDetail>>;
const product = (overrides: Partial<Product> = {}): Product =>
  ({ product_id: 1, title: 'Shirt', price: 10, stock: 3, sales_count: 0, rating: 5, has_sku: false, ...overrides });
const cartItems = () => useCartStore.getState().items;
const signIn = () => useAuthStore.getState().login({ user_id: 1, username: 'one', email: 'one@example.test' }, 'one');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('quick add to cart', () => {
  it.each([true, false])('sends SKU products to explicit selection and adds ordinary ones directly (has_sku=%s)', async (has_sku) => {
    signIn();
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: product({ has_sku, price: '15.00' }) });

    expect(await quickAddToCart(1)).toBe(has_sku ? 'select' : 'added');

    expect(cartApi.add).toHaveBeenCalledTimes(has_sku ? 0 : 1);
    expect(cartItems()).toHaveLength(has_sku ? 0 : 1);
    if (!has_sku) expect(cartItems()[0].price).toBe(15);
  });

  it('rejects a sold out base product without adding it', async () => {
    signIn();
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: product({ stock: 0 }) });

    await expect(quickAddToCart(1)).rejects.toThrow();
    expect(cartApi.add).not.toHaveBeenCalled();
  });

  it('leaves the local cart alone when the server refuses the add', async () => {
    signIn();
    vi.mocked(productApi.getDetail).mockResolvedValue({ product: product() });
    vi.mocked(cartApi.add).mockRejectedValue(new Error('Stock changed'));

    await expect(quickAddToCart(1)).rejects.toThrow('Stock changed');
    expect(cartItems()).toHaveLength(0);
  });

  const lateCases = (['detail', 'add'] as const).flatMap(phase =>
    (['account', 'storage'] as const).map(change => ({ phase, change })));

  it.each(lateCases)('ignores a late $phase response after a $change change', async ({ phase, change }) => {
    signIn();
    const pending = deferred<unknown>();
    if (phase === 'detail') vi.mocked(productApi.getDetail).mockReturnValue(pending.promise as Promise<Detail>);
    else {
      vi.mocked(productApi.getDetail).mockResolvedValue({ product: product() });
      vi.mocked(cartApi.add).mockReturnValue(pending.promise as never);
    }

    const work = quickAddToCart(1);
    await flush();
    if (change === 'account') useAuthStore.getState().login({ user_id: 2, username: 'two', email: 'two@example.test' }, 'two');
    else localStorage.setItem('token', 'two');
    pending.resolve(phase === 'detail' ? { product: product() } : {});

    expect(await work).toBeNull();
    expect(cartItems()).toHaveLength(0);
    expect(cartApi.add).toHaveBeenCalledTimes(phase === 'detail' ? 0 : 1);
  });

  it.each(['detail', 'add'] as const)('suppresses late selection and cart changes once the view is left during %s', async (phase) => {
    signIn();
    const pending = deferred<unknown>();
    const item = product({ has_sku: phase === 'detail' });
    if (phase === 'detail') vi.mocked(productApi.getDetail).mockReturnValue(pending.promise as Promise<Detail>);
    else {
      vi.mocked(productApi.getDetail).mockResolvedValue({ product: item });
      vi.mocked(cartApi.add).mockReturnValue(pending.promise as never);
    }
    let active = true;

    const work = quickAddToCart(1, () => active);
    await flush();
    active = false;
    pending.resolve(phase === 'detail' ? { product: item } : {});

    expect(await work).toBeNull();
    expect(cartItems()).toHaveLength(0);
  });
});
