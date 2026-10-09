import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '@/components/AppShell';
import CartPage from '@/app/cart/page';
import ProductCard from '@/components/ProductCard';
import api from '@/lib/api';
import { addToCart } from '@/lib/cart-add';
import { readCanonicalCart } from '@/lib/cart-sync';
import { storePendingCheckout } from '@/lib/pending-checkout';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, usePathname: () => navigation.pathname }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

const buyer = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const other = { user_id: 2, username: 'Other', email: 'other@example.test' };
const item: CartItem = { cart_id: 1, product_id: 11, quantity: 3, title: 'Cart item', price: '10.00', stock: 9 };
const originalAdapter = api.defaults.adapter;
const lost = () => new AxiosError('Lost reply', 'ERR_NETWORK');
beforeEach(() => { navigation.pathname = '/'; });
afterEach(() => { api.defaults.adapter = originalAdapter; });
function rememberBuyer() {
  localStorage.setItem('session', 'buyer-one');
  localStorage.setItem('user', JSON.stringify(buyer));
}
function fixture(cart: AxiosAdapter) {
  let reads = 0;
  api.defaults.adapter = async config => {
    let data: unknown;
    if (config.url?.startsWith('/cart')) { if (config.method === 'get') reads++; return cart(config); }
    if (config.url === '/search/hot') data = { keywords: [] };
    else if (config.url === '/search/history') data = { history: [] };
    else if (config.url === '/addresses') data = { addresses: [{ address_id: 1, user_id: 1, receiver_name: 'Buyer', phone: '13800000000', is_default: 1 }] };
    else if (config.url === '/orders/preview') {
      const quantity = JSON.parse(config.data).items.reduce((count: number, row: CartItem) => count + row.quantity, 0);
      data = { original_amount: quantity * 10, discount_amount: 0, total_amount: quantity * 10, coupon: null, available_coupons: [] };
    } else if (config.url === '/orders') data = { order_id: 9 };
    else throw new Error(`Unexpected ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { reads: () => reads };
}
const answer = (config: Parameters<AxiosAdapter>[0], data: unknown) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
const badge = () => screen.getByRole('link', { name: '购物车' });
const shell = (cart = false) => <AppShell>{cart ? <CartPage /> : <h1>Storefront</h1>}</AppShell>;

describe('global canonical cart badge', () => {
  it('restores the canonical count on a fresh storefront page before visiting the cart', async () => {
    rememberBuyer();
    const calls = fixture(async config => answer(config, { items: [item] }));
    render(shell()); await settle();
    expect(calls.reads()).toBe(1);
    expect(badge()).toHaveTextContent('3');
    expect(navigation.push).not.toHaveBeenCalledWith('/cart');
  });
  it.each(['zh-CN', 'en'] as const)('distinguishes loading, failure and a confirmed empty cart with a retry (%s)', async locale => {
    useAuthStore.getState().login(buyer, 'buyer-one');
    useLocaleStore.getState().setLocale(locale);
    const initial = deferred<unknown>(); let requests = 0;
    fixture(async config => answer(config, ++requests === 1 ? await initial.promise : { items: [] }));
    render(shell()); await settle();
    expect(screen.getByText(locale === 'en' ? 'Loading your cart...' : '正在加载购物车...')).toBeInTheDocument();
    act(() => initial.reject(lost())); await settle();
    const retry = screen.getByRole('button', { name: locale === 'en' ? 'Reload cart' : '重新加载购物车' });
    expect(retry).toHaveAttribute('title', locale === 'en' ? 'Unable to load your cart. Please try again.' : '加载购物车失败，请重试');
    fireEvent.click(retry); await settle();
    expect(requests).toBe(2);
    expect(screen.queryByRole('button', { name: locale === 'en' ? 'Reload cart' : '重新加载购物车' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: locale === 'en' ? 'Cart' : '购物车' })).toHaveTextContent('0');
  });
  it.each(['success', 'failure'])('ignores customer A’s late %s after customer B signs in', async outcome => {
    rememberBuyer(); const old = deferred<unknown>();
    fixture(async config => answer(config, useAuthStore.getState().user?.user_id === 1 ? await old.promise : { items: [{ ...item, quantity: 2 }] }));
    render(shell()); await settle();
    act(() => useAuthStore.getState().login(other, 'buyer-two')); await settle();
    expect(badge()).toHaveTextContent('2');
    act(() => { if (outcome === 'success') old.resolve({ items: [item] }); else old.reject(lost()); }); await settle();
    expect(badge()).toHaveTextContent('2');
    expect(screen.queryByRole('button', { name: '重新加载购物车' })).not.toBeInTheDocument();
  });
  it('clears an old count immediately on logout and ignores the late initial read', async () => {
    rememberBuyer(); const old = deferred<unknown>();
    fixture(async config => answer(config, await old.promise));
    render(shell()); await settle();
    act(() => useAuthStore.getState().logout());
    act(() => old.resolve({ items: [item] })); await settle();
    expect(useCartStore.getState().items).toEqual([]);
    expect(badge()).not.toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: '重新加载购物车' })).not.toBeInTheDocument();
  });
  it.each(['before receipt', 'after canonical add'])('never publishes a slow initial read arriving %s around an add', async arrival => {
    rememberBuyer(); const old = deferred<unknown>(), receipt = deferred<void>(); let reads = 0;
    const calls = fixture(async config => {
      if (config.method === 'get') return answer(config, ++reads === 1 ? await old.promise : { items: [{ ...item, quantity: 4 }] });
      await receipt.promise;
      return answer(config, { add_key: JSON.parse(config.data).add_key, replayed: false });
    });
    render(shell()); await settle(); expect(calls.reads()).toBe(1);
    let addition!: Promise<boolean>;
    act(() => { addition = addToCart({ product_id: 11, quantity: 1 }); }); await settle();
    if (arrival === 'before receipt') {
      act(() => old.resolve({ items: [item] })); await settle();
      expect(badge()).not.toHaveTextContent('3');
      expect(screen.getByText('正在加载购物车...')).toBeInTheDocument();
    }
    await act(async () => { receipt.resolve(); await addition; }); await settle();
    expect(badge()).toHaveTextContent('4');
    if (arrival === 'after canonical add') { act(() => old.resolve({ items: [item] })); await settle(); }
    expect(badge()).toHaveTextContent('4');
  });
  it('shares the first canonical read with the cart page without losing initial selection', async () => {
    rememberBuyer(); navigation.pathname = '/cart';
    const calls = fixture(async config => answer(config, { items: [item] }));
    render(shell(true)); await settle();
    expect(calls.reads()).toBe(1);
    expect(badge()).toHaveTextContent('3');
    expect(screen.getByRole('checkbox', { name: '选择 Cart item' })).toBeChecked();
    expect(screen.getByRole('button', { name: '结算 (3)' })).toBeEnabled();
  });
  it.each(['quantity', 'remove', 'checkout'])('tracks an acknowledged %s operation without an obsolete initial read undoing its count', async operation => {
    rememberBuyer(); const old = deferred<unknown>(); let reads = 0;
    fixture(async config => config.method === 'get' ? answer(config, ++reads === 1 ? await old.promise : { items: [item] }) : answer(config, {}));
    const view = render(shell()); await settle(); expect(reads).toBe(1);
    // A newer canonical read can arrive through another storefront entry while the global read is pending.
    act(() => useCartStore.getState().setItems([item]));
    navigation.pathname = '/cart'; view.rerender(shell(true)); await settle();
    if (operation === 'quantity') fireEvent.click(screen.getByRole('button', { name: '-' }));
    else if (operation === 'remove') fireEvent.click(screen.getByRole('button', { name: '删除' }));
    else fireEvent.click(screen.getByRole('button', { name: '结算 (3)' }));
    await settle();
    expect(useCartStore.getState().getTotalCount()).toBe(operation === 'quantity' ? 2 : 0);
    act(() => old.resolve({ items: [item] })); await settle();
    expect(badge()).toHaveTextContent(operation === 'quantity' ? '2' : '0');
  });
  it.each(['quantity', 'remove', 'checkout'])('invalidates a refresh before an in-flight %s write receives its acknowledgement', async operation => {
    rememberBuyer(); navigation.pathname = '/cart';
    const old = deferred<unknown>(), receipt = deferred<void>(); let reads = 0;
    fixture(async config => {
      if (config.method === 'get') return answer(config, ++reads === 1 ? { items: [item] } : await old.promise);
      await receipt.promise; return answer(config, {});
    });
    if (operation === 'checkout') {
      const adapter = api.defaults.adapter as AxiosAdapter;
      api.defaults.adapter = async config => {
        if (config.url === '/orders') await receipt.promise;
        return adapter(config);
      };
    }
    render(shell(true)); await settle();
    let refresh!: ReturnType<typeof readCanonicalCart>;
    act(() => { refresh = readCanonicalCart(); }); await settle();
    fireEvent.click(screen.getByRole('button', { name: operation === 'quantity' ? '-' : operation === 'remove' ? '删除' : '结算 (3)' }));
    await settle();
    await act(async () => { old.resolve({ items: [{ ...item, quantity: 8 }] }); await refresh; }); await settle();
    expect(useCartStore.getState().getTotalCount()).toBe(3);
    expect(badge()).not.toHaveTextContent('8');
    expect(screen.getByText('正在加载购物车...')).toBeInTheDocument();
    act(() => receipt.resolve()); await settle();
    expect(badge()).toHaveTextContent(operation === 'quantity' ? '2' : '0');
  });
  it.each(['add', 'unavailable quantity', 'checkout retry', 'uncertain quantity'])('does not reuse a pre-acknowledgement read to confirm %s', async operation => {
    rememberBuyer(); navigation.pathname = '/cart';
    const receipt = deferred<void>(), oldReadReply = deferred<void>();
    const unavailable = operation === 'unavailable quantity';
    const initialItem = unavailable ? { ...item, stock: 2, available: false, unavailable_reason: '库存不足' } : item;
    let serverItem = initialItem, reads = 0;
    fixture(async config => {
      if (config.method === 'get') {
        const snapshot = serverItem;
        if (++reads === 2) await oldReadReply.promise;
        return answer(config, { items: [snapshot] });
      }
      await receipt.promise;
      serverItem = { ...initialItem, quantity: operation === 'add' ? 4 : 2, available: true };
      if (operation === 'uncertain quantity') throw lost();
      return answer(config, operation === 'add' ? { add_key: JSON.parse(config.data).add_key, replayed: false } : {});
    });
    if (operation === 'checkout retry') {
      storePendingCheckout({ sessionKey: JSON.stringify(['buyer-one', buyer.user_id]), input: {
        items: [{ product_id: item.product_id, quantity: 1 }], shipping_address_id: 1,
        checkout_key: '12345678-1234-1234-1234-123456789abc',
      } });
      const adapter = api.defaults.adapter as AxiosAdapter;
      api.defaults.adapter = async config => {
        if (config.url === '/orders') {
          await receipt.promise; serverItem = { ...item, quantity: 2 };
        }
        return adapter(config);
      };
    }
    render(shell(true)); await settle(); expect(reads).toBe(1);
    let addition: Promise<boolean> | undefined;
    if (operation === 'add') act(() => { addition = addToCart({ product_id: item.product_id, quantity: 1 }); });
    else fireEvent.click(screen.getByRole('button', { name: operation === 'checkout retry' ? '重试确认订单' : '-' }));
    await settle();
    let preAcknowledgementRead!: ReturnType<typeof readCanonicalCart>;
    act(() => { preAcknowledgementRead = readCanonicalCart(); }); await settle();
    expect(reads).toBe(2);
    act(() => receipt.resolve()); await settle();
    await act(async () => { oldReadReply.resolve(); await preAcknowledgementRead; if (addition) await addition; }); await settle();
    expect(reads).toBe(3);
    expect(useCartStore.getState().getTotalCount()).toBe(operation === 'add' ? 4 : 2);
    expect(badge()).toHaveTextContent(operation === 'add' ? '4' : '2');
    if (unavailable) expect(screen.getByRole('checkbox', { name: '选择 Cart item' })).toBeEnabled();
  });
  it.each(['badge', 'page'])('keeps a failed shared cart read unconfirmed and reconciles both views after %s retry', async retryFrom => {
    rememberBuyer(); navigation.pathname = '/cart';
    let requests = 0;
    fixture(async config => { if (++requests === 1) throw lost(); return answer(config, { items: [item] }); });
    render(shell(true)); await settle();
    expect(screen.getByRole('button', { name: '重新加载购物车' })).toBeInTheDocument();
    expect(badge()).not.toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: retryFrom === 'badge' ? '重新加载购物车' : '重新加载' })); await settle();
    expect(requests).toBe(2);
    expect(badge()).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: '重新加载购物车' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 Cart item' })).toBeChecked();
    expect(screen.getByRole('button', { name: '结算 (3)' })).toBeEnabled();
  });
  it('keeps an acknowledged checkout retry loading until its asynchronous canonical read completes', async () => {
    rememberBuyer(); navigation.pathname = '/cart';
    storePendingCheckout({ sessionKey: JSON.stringify(['buyer-one', buyer.user_id]), input: {
      items: [{ product_id: item.product_id, quantity: 1 }], shipping_address_id: 1,
      checkout_key: '12345678-1234-1234-1234-123456789abc',
    } });
    const canonical = deferred<unknown>(); let reads = 0;
    fixture(async config => answer(config, ++reads === 1 ? { items: [item] } : await canonical.promise));
    render(shell(true)); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重试确认订单' })); await settle();
    const wasLoading = screen.queryByText('正在加载购物车...') !== null;
    const showedReadFailure = screen.queryByRole('button', { name: '重新加载购物车' }) !== null;
    act(() => canonical.resolve({ items: [{ ...item, quantity: 2 }] })); await settle();
    expect(navigation.push).toHaveBeenCalledWith('/orders/9');
    expect(wasLoading).toBe(true);
    expect(showedReadFailure).toBe(false);
    expect(badge()).toHaveTextContent('2');
  });
  it.each(['add', 'quantity', 'remove', 'checkout'])('blocks a cross-page %s until an earlier cart write finishes and synchronizes after unmount', async operation => {
    rememberBuyer(); navigation.pathname = '/cart';
    const receipt = deferred<void>(); let quantity = 3;
    const writes = { post: 0, put: 0, delete: 0, checkout: 0 };
    fixture(async config => {
      if (config.method === 'get') return answer(config, { items: [{ ...item, quantity }] });
      writes[config.method as 'post' | 'put' | 'delete']++;
      if (config.method === 'put') { await receipt.promise; quantity = JSON.parse(config.data).quantity; }
      if (config.method === 'post') quantity++;
      return answer(config, config.method === 'post' ? { add_key: JSON.parse(config.data).add_key, replayed: false } : {});
    });
    const product = { product_id: item.product_id, title: item.title, price: item.price, stock: item.stock, has_sku: false, sales_count: 0, rating: 0 };
    const adapter = api.defaults.adapter as AxiosAdapter;
    api.defaults.adapter = async config => {
      if (config.url === `/products/${item.product_id}`) return answer(config, { product });
      if (config.url === '/orders') writes.checkout++;
      return adapter(config);
    };
    const view = render(shell(true)); await settle();
    fireEvent.click(screen.getByRole('button', { name: '-' })); await settle();
    expect(writes.put).toBe(1);
    navigation.pathname = operation === 'add' ? '/products' : '/cart';
    view.rerender(<AppShell>{operation === 'add' ? <ProductCard product={product} /> : <CartPage key="new-page" />}</AppShell>); await settle();
    const button = screen.getByRole('button', { name: operation === 'add' ? '加入' : operation === 'quantity' ? '-' : operation === 'remove' ? '删除' : '结算 (3)' });
    let secondWrite: Promise<unknown> | undefined;
    if (operation === 'add') fireEvent.click(button);
    else secondWrite = captureHandler(button)(); // A stale callback must respect the global lock too.
    await settle();
    const writesBeforeReceipt = { ...writes };
    act(() => receipt.resolve()); await settle();
    if (secondWrite) await secondWrite;
    expect(writesBeforeReceipt).toEqual({ post: 0, put: 1, delete: 0, checkout: 0 });
    expect(quantity).toBe(2);
    expect(useCartStore.getState().pendingWrites).toBe(0);
    expect(badge()).toHaveTextContent('2');
    if (operation === 'add') {
      fireEvent.click(screen.getByRole('button', { name: '加入' })); await settle();
      expect(writes.post).toBe(1); expect(badge()).toHaveTextContent('3');
    }
  });
  it('restarts a storefront read abandoned by a visit to the admin area', async () => {
    rememberBuyer(); const old = deferred<unknown>(); let reads = 0;
    fixture(async config => answer(config, ++reads === 1 ? await old.promise : { items: [item] }));
    const view = render(shell()); await settle(); expect(reads).toBe(1);
    navigation.pathname = '/admin/login'; view.rerender(shell()); await settle();
    navigation.pathname = '/'; view.rerender(shell()); await settle();
    expect(reads).toBe(2); expect(badge()).toHaveTextContent('3');
    act(() => old.resolve({ items: [{ ...item, quantity: 8 }] })); await settle();
    expect(badge()).toHaveTextContent('3');
  });
});
