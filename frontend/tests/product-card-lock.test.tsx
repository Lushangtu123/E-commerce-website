import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductCard from '@/components/ProductCard';
import api, { cartApi, productApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { captureHandler, clickTogether, deferred, render, settle } from './helpers';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const product: Product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0 };
beforeEach(() => {
  useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unexpected outbound request'));
  vi.spyOn(productApi, 'getDetail').mockImplementation(async id => ({ product: { ...product, product_id: id } }));
  vi.spyOn(cartApi, 'add').mockResolvedValue({} as never);
});
describe('card add operation lock', () => {
  it('blocks repeated events in the same render before the detail request completes', async () => {
    const read = deferred<{ product: Product }>(); vi.mocked(productApi.getDetail).mockReturnValue(read.promise);
    render(<ProductCard product={product} />); const button = screen.getByRole('button', { name: '加入' });
    clickTogether(button, button); await settle();
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve({ product })); await settle();
    expect(cartApi.add).toHaveBeenCalledExactlyOnceWith({ product_id: 1, quantity: 1 });
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });
  it('retains the synchronous lock while the cart write is still pending', async () => {
    const write = deferred<unknown>(); vi.mocked(cartApi.add).mockReturnValue(write.promise as never);
    render(<ProductCard product={product} />); const action = captureHandler(screen.getByRole('button', { name: '加入' }));
    const first = action(); await settle(); const second = action(); await settle();
    expect(cartApi.add).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve({})); await Promise.all([first, second]); await settle();
    expect(screen.getByRole('button', { name: '加入' })).toBeEnabled();
  });
  it('unlocks after a failure so a deliberate retry can succeed', async () => {
    vi.mocked(cartApi.add).mockRejectedValueOnce(new Error('Refused'));
    render(<ProductCard product={product} />);
    fireEvent.click(screen.getByRole('button', { name: '加入' })); await settle();
    expect(useCartStore.getState().items).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '加入' })); await settle();
    expect(cartApi.add).toHaveBeenCalledTimes(2); expect(useCartStore.getState().items[0].quantity).toBe(1);
  });
  it('an old product operation cannot unlock a new pending card operation', async () => {
    const old = deferred<{ product: Product }>(), fresh = deferred<{ product: Product }>();
    vi.mocked(productApi.getDetail).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const view = render(<ProductCard product={product} />);
    fireEvent.click(screen.getByRole('button', { name: '加入' })); await settle();
    view.rerender(<ProductCard product={{ ...product, product_id: 2 }} />);
    const nextAction = captureHandler(screen.getByRole('button', { name: '加入' }));
    const next = nextAction(); await settle();
    await act(async () => old.resolve({ product })); await settle();
    expect(screen.getByRole('button', { name: '处理中...' })).toBeDisabled();
    await nextAction(); expect(productApi.getDetail).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve({ product: { ...product, product_id: 2 } })); await next; await settle();
    expect(cartApi.add).toHaveBeenCalledExactlyOnceWith({ product_id: 2, quantity: 1 });
  });
  it('a captured old account action cannot write for the new account', async () => {
    render(<ProductCard product={product} />); const old = captureHandler(screen.getByRole('button', { name: '加入' }));
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Second', email: 'second@example.test' }, 'second-session'));
    await old(); await settle();
    expect(productApi.getDetail).not.toHaveBeenCalled(); expect(cartApi.add).not.toHaveBeenCalled();
  });
});
