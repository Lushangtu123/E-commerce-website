import { act, fireEvent, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import ProductCard from '@/components/ProductCard';
import { cartApi, productApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const product: Product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0 };
const customer = { user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' };

it.each([false, true])('keeps server-rendered purchase controls disabled before the card hydrates (session restored=$0)', restored => {
  if (restored) useAuthStore.getState().login(customer, 'fixture-session');
  const container = document.createElement('div');
  container.innerHTML = renderToString(<ProductCard product={product} />);
  expect(container.querySelector('h3')).toHaveTextContent('Fixture');
  expect(container.querySelector('button')).toBeDisabled();
});

it('waits for session restoration, then lets an anonymous customer open sign-in', () => {
  render(<ProductCard product={product} />);
  const button = screen.getByRole('button', { name: '加入' });
  expect(button).toBeDisabled();
  act(() => useAuthStore.getState().hydrate());
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(router.push).toHaveBeenCalledWith('/login');
});

it('hydrates the disabled server control without mismatch and preserves one add for repeated clicks', async () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(<ProductCard product={product} />);
  expect(container.querySelector('button')).toBeDisabled();
  useAuthStore.getState().login(customer, 'fixture-session');
  vi.spyOn(productApi, 'getDetail').mockResolvedValue({ product });
  vi.spyOn(cartApi, 'add').mockImplementation(async ({ add_key }) => ({ message: '添加成功', add_key, replayed: false }));
  vi.spyOn(cartApi, 'list').mockResolvedValue({ items: [{ cart_id: 7, product_id: 1, quantity: 1, title: 'Fixture', price: 10, stock: 3 }] });
  const failures: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, <ProductCard product={product} />, { onRecoverableError: error => failures.push(error) }); });
    const button = container.querySelector('button')!;
    expect(button).toBeEnabled();
    act(() => { button.click(); button.click(); });
    await settle();
    expect(failures).toEqual([]);
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
    expect(cartApi.add).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
  } finally { if (root) await act(() => root!.unmount()); }
});
