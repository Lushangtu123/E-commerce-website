import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import CartPage from '@/app/cart/page';
import { productApi, cartApi, addressApi, orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '1' }), useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  productApi: { getDetail: vi.fn() }, cartApi: { add: vi.fn(), list: vi.fn(), updateQuantity: vi.fn(), remove: vi.fn() },
  reviewApi: { listByProduct: vi.fn(async () => ({ reviews: [], total: 0 })) },
  recommendationApi: { getRelated: vi.fn(async () => ({ related_products: [] })) },
  favoriteApi: { check: vi.fn(async () => ({ is_favorited: false })) }, browseApi: { record: vi.fn(async () => ({})) },
  addressApi: { list: vi.fn() }, orderApi: { preview: vi.fn(), create: vi.fn() },
}));
const owner = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const product = { product_id: 1, title: 'Current purchase', price: 10, stock: 20, sales_count: 0, rating: 0 };
const address = { address_id: 41, receiver_name: 'Buyer', phone: '13800138000', province: 'P', city: 'C', district: 'D', detail_address: 'Street', is_default: false };

async function buy(rows: CartItem[], skuId?: number) {
  useAuthStore.getState().login(owner, 'buyer-session');
  useCartStore.getState().setItems(rows.map(row => ({ ...row })));
  vi.mocked(productApi.getDetail).mockResolvedValue({ product: { ...product, ...(skuId && { has_sku: true,
    skus: [{ product_id: 1, sku_id: skuId, sku_code: 'RED', specs: { Color: 'Red' }, stock: 20, price: 10, status: 1 }] }) } });
  vi.mocked(cartApi.list).mockImplementation(async () => ({ items: rows.map(row => ({ ...row })) }));
  vi.mocked(cartApi.add).mockImplementation(async input => {
    const row = rows.find(row => row.product_id === input.product_id && row.sku_id === input.sku_id);
    if (row) row.quantity += input.quantity;
    else rows.push({ cart_id: 11, title: product.title, price: 10, stock: 20, ...input });
    return { message: '添加成功', add_key: input.add_key, replayed: false };
  });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [address] });
  vi.mocked(orderApi.preview).mockImplementation(async input => ({ original_amount: input.items.reduce((sum, row) => sum + row.quantity * 10, 0),
    total_amount: input.items.reduce((sum, row) => sum + row.quantity * 10, 0), discount_amount: 0, coupon: null, available_coupons: [] }));
  window.history.replaceState(null, '', '/products/1');
  const view = render(<ProductDetail />); await settle();
  if (skuId) fireEvent.change(screen.getByLabelText('商品规格'), { target: { value: String(skuId) } });
  fireEvent.click(screen.getByRole('button', { name: '立即购买' })); await settle();
  view.unmount();
  const href = router.push.mock.calls.at(-1)?.[0];
  expect(href).toMatch(/^\/cart\?buy_now=[a-f0-9-]{36}$/);
  window.history.replaceState(null, '', href);
  const cart = render(<CartPage />); await settle();
  return { cart, href };
}

it('quotes and purchases only the chosen quantity, keeping prior cart units and unrelated products', async () => {
  const rows: CartItem[] = [{ cart_id: 11, product_id: 1, quantity: 3, title: product.title, price: 10, stock: 20 },
    { cart_id: 22, product_id: 2, quantity: 3, title: 'Other cart product', price: 20, stock: 20 }];
  await buy(rows);
  expect(orderApi.preview).toHaveBeenLastCalledWith({ items: [{ product_id: 1, quantity: 1 }] });
  expect(screen.getByRole('button', { name: '结算 (1)' })).toBeEnabled();
  expect(screen.queryByText('Other cart product')).not.toBeInTheDocument();
  expect(useCartStore.getState().items.map(row => row.quantity)).toEqual([3, 3]);
  expect(cartApi.add).not.toHaveBeenCalled();
  vi.mocked(orderApi.create).mockImplementation(async input => {
    expect(input.checkout_source).toBe('buy_now');
    return { order_id: 55, message: '订单创建成功' };
  });
  fireEvent.click(screen.getByRole('button', { name: '结算 (1)' })); await settle();
  expect(orderApi.create).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 41, checkout_key: expect.any(String), checkout_source: 'buy_now', expected_quote: { original_amount: 10, discount_amount: 0, total_amount: 10 } });
  expect(useCartStore.getState().items.map(row => row.quantity)).toEqual([3, 3]);
});

it('keeps the exact selected SKU and quantity after a reload without repeating the add', async () => {
  const rows: CartItem[] = [{ cart_id: 11, product_id: 1, sku_id: 5, quantity: 3, title: product.title, price: 10, stock: 20 },
    { cart_id: 12, product_id: 1, sku_id: 6, quantity: 2, title: 'Other variant', price: 20, stock: 20 }];
  const { cart } = await buy(rows, 5);
  expect(orderApi.preview).toHaveBeenLastCalledWith({ items: [{ product_id: 1, sku_id: 5, quantity: 1 }] });
  cart.unmount(); render(<CartPage />); await settle();
  expect(cartApi.add).not.toHaveBeenCalled();
  expect(orderApi.preview).toHaveBeenLastCalledWith({ items: [{ product_id: 1, sku_id: 5, quantity: 1 }] });
  expect(screen.queryByText('Other variant')).not.toBeInTheDocument();
  act(() => useLocaleStore.getState().setLocale('en'));
  expect(screen.getByRole('heading', { name: 'Confirm this purchase' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to full cart' })).toHaveAttribute('href', '/cart');
});

it('retains the original checkout on a lost reply and explicitly retries the same quantity and key', async () => {
  const { cart, href } = await buy([]);
  vi.mocked(orderApi.create).mockRejectedValueOnce(new Error('Lost response'));
  fireEvent.click(screen.getByRole('button', { name: '结算 (1)' })); await settle();
  const input = vi.mocked(orderApi.create).mock.calls[0][0];
  expect(input.checkout_key).toBe(new URL(href, 'http://localhost').searchParams.get('buy_now'));
  cart.unmount(); render(<CartPage />); await settle();
  expect(orderApi.create).toHaveBeenCalledTimes(1);
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  fireEvent.click(screen.getByRole('button', { name: '重试确认订单' })); await settle();
  expect(orderApi.create).toHaveBeenLastCalledWith(input);
  expect(router.push).toHaveBeenLastCalledWith('/orders/55');
});

it('never falls back to checkout of the full cart when an explicit purchase is missing or belongs to another session', async () => {
  const { cart } = await buy([]);
  act(() => useAuthStore.getState().login({ ...owner, user_id: 2 }, 'other-session')); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('本次购买信息已失效');
  expect(screen.queryByRole('button', { name: /^结算/ })).not.toBeInTheDocument();
  const reads = vi.mocked(orderApi.preview).mock.calls.length;
  cart.unmount(); window.history.replaceState(null, '', '/cart?buy_now=invalid'); render(<CartPage />); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('本次购买信息已失效');
  expect(orderApi.preview).toHaveBeenCalledTimes(reads);
  expect(orderApi.create).not.toHaveBeenCalled();
});

it('returns to ordinary full-cart selection on same-route navigation and retires the previous purchase handler', async () => {
  const { cart } = await buy([{ cart_id: 22, product_id: 2, quantity: 3, title: 'Other cart product', price: 10, stock: 20 }]);
  const oldCheckout = captureHandler(screen.getByRole('button', { name: '结算 (1)' }));
  window.history.replaceState(null, '', '/cart'); cart.rerender(<CartPage />); await settle();
  expect(screen.getByRole('button', { name: '结算 (3)' })).toBeEnabled();
  expect(screen.getByText('Other cart product')).toBeInTheDocument();
  await oldCheckout(); expect(orderApi.create).not.toHaveBeenCalled();
});

it('blocks double checkout synchronously and retains its key if clearing the purchase storage fails', async () => {
  const { cart, href } = await buy([]);
  const held = deferred<{ order_id: number; message: string }>();
  vi.mocked(orderApi.create).mockReturnValue(held.promise);
  const checkout = captureHandler(screen.getByRole('button', { name: '结算 (1)' }));
  const first = checkout(); await checkout();
  expect(orderApi.create).toHaveBeenCalledTimes(1);
  vi.spyOn(window.sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  await act(async () => held.resolve({ order_id: 55, message: '订单创建成功' })); await first; await settle();
  cart.unmount(); render(<CartPage />); await settle();
  // pending-checkout can also survive failed storage removal: retry must use the original key.
  const retry = screen.queryByRole('button', { name: '重试确认订单' }) ?? screen.getByRole('button', { name: '结算 (1)' });
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  fireEvent.click(retry); await settle();
  expect(vi.mocked(orderApi.create).mock.calls.map(([input]) => input.checkout_key)).toEqual(Array(2).fill(new URL(href, 'http://localhost').searchParams.get('buy_now')));
});

it('refuses a fresh purchase before adding when browser storage cannot save it', async () => {
  useAuthStore.getState().login(owner, 'buyer-session');
  vi.mocked(productApi.getDetail).mockResolvedValue({ product });
  render(<ProductDetail />); await settle();
  vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  fireEvent.click(screen.getByRole('button', { name: '立即购买' })); await settle();
  expect(cartApi.add).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('keeps ordinary Add to cart separate from the purchase scope', async () => {
  const { cart } = await buy([]); cart.unmount(); router.push.mockClear();
  render(<ProductDetail />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '加入购物车' })); await settle();
  expect(cartApi.add).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
});

it('restores a legacy cart-backed purchase without changing its checkout source or key', async () => {
  useAuthStore.getState().login(owner, 'buyer-session');
  const id = '11111111-1111-4111-8111-111111111111';
  sessionStorage.setItem('buy-now:buyer-session:1', JSON.stringify({ id, ready: true, input: { product_id: 1, quantity: 1 } }));
  window.history.replaceState(null, '', `/cart?buy_now=${id}`);
  vi.mocked(cartApi.list).mockResolvedValue({ items: [{ cart_id: 11, product_id: 1, title: product.title, price: 10, stock: 20, quantity: 4 }] });
  vi.mocked(addressApi.list).mockResolvedValue({ addresses: [address] });
  vi.mocked(orderApi.preview).mockResolvedValue({ original_amount: 10, total_amount: 10, discount_amount: 0, coupon: null, available_coupons: [] });
  vi.mocked(orderApi.create).mockResolvedValue({ order_id: 55, message: '订单创建成功' });
  render(<CartPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '结算 (1)' })); await settle();
  expect(orderApi.create).toHaveBeenCalledExactlyOnceWith({ items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 41, checkout_key: id, expected_quote: { original_amount: 10, discount_amount: 0, total_amount: 10 } });
  expect(productApi.getDetail).not.toHaveBeenCalled();
  expect(cartApi.add).not.toHaveBeenCalled();
});
