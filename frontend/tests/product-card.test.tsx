import { act, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProductCard from '@/components/ProductCard';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
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

it.each([
  { price: '99.00', original_price: '100.00', discounted: true },
  { price: '9.99', original_price: '10.00', discounted: true },
  { price: '100.00', original_price: '99.00', discounted: false },
  { price: '10.00', original_price: '9.99', discounted: false },
  { price: '10.00', original_price: '10.00', discounted: false },
  { price: '10', original_price: '10.00', discounted: false },
  { price: 99, original_price: 100, discounted: true },
  { price: '99.00', original_price: 100, discounted: true },
  { price: 99, original_price: '100.00', discounted: true },
  { price: '0.00', original_price: '10.00', discounted: true },
  { price: '10.00', original_price: 0, discounted: false },
  { price: '10.00', original_price: '0.00', discounted: false },
  { price: '10.00', original_price: null, discounted: false },
  { price: '10.00', original_price: undefined, discounted: false },
])('shows a promotion only when original price $original_price exceeds selling price $price', ({ price, original_price, discounted }) => {
  const product = { product_id: 1, title: 'Coffee', price, original_price, stock: 2, sales_count: 7, rating: 4.5 };
  const { container, rerender } = render(<ProductCard product={product} />);

  for (const [locale, badge] of [['zh-CN', '促销'], ['en', 'Sale']] as const) {
    act(() => useLocaleStore.setState({ locale }));
    rerender(<ProductCard product={product} />);
    expect(screen.queryByText(badge, { exact: true }) !== null).toBe(discounted);
    const crossedOutPrice = container.querySelector('.line-through');
    if (discounted) expect(crossedOutPrice).toHaveTextContent(`¥${original_price}`);
    else expect(crossedOutPrice).toBeNull();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(`¥${price}`, { exact: true })).toBeVisible();
  }
});
