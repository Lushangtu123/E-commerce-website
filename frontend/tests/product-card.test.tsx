import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProductCard from '@/components/ProductCard';
import { useAuthStore } from '@/store/useAuthStore';
import { render } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

it.each([
  { has_sku: true, stock: '0' }, { has_sku: true, stock: 0 }, { has_sku: true, stock: '2' },
  { has_sku: false, stock: '0' }, { has_sku: false, stock: 0 }, { has_sku: false, stock: '2' },
])('product cards disable exhausted products when MySQL aggregate stock is a string (has_sku=$has_sku, stock=$stock)', ({ has_sku, stock }) => {
  useAuthStore.getState().login({ user_id: 1, username: 'customer', email: 'customer@example.test' }, 'customer-session');
  // MySQL returns aggregate stock as a string; the Product type does not cover that.
  const product = { product_id: 1, title: 'Shirt', price: 15, stock: stock as number, sales_count: 0, rating: 5, has_sku };

  render(<ProductCard product={product} />);

  const button = screen.getByRole('button');
  if (Number(stock) === 0) {
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('已售罄');
  } else {
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent(has_sku ? '选规格' : '加入');
  }
});
