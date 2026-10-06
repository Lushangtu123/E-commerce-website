import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProductReviewList from '@/components/ProductReviewList';
import RelatedProducts from '@/components/RelatedProducts';
import type { Product } from '@/lib/api';
import { render } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const reviews = [
  { review_id: 1, rating: 4, content: 'Bright and sturdy', username: 'Ada', created_at: '2026-09-01T00:00:00Z' },
  { review_id: 2, rating: 2, content: 'Too small', username: 'Bo', created_at: '2026-09-02T00:00:00Z' },
];
const related: Product[] = [
  { product_id: 21, title: 'Desk lamp', price: '30.00', stock: 3, sales_count: 1, rating: 5 },
  { product_id: 22, title: 'Floor lamp', price: '80.00', stock: 2, sales_count: 0, rating: 4 },
];

describe('product reviews', () => {
  it('lists each review with its author, star rating and text', () => {
    render(<ProductReviewList reviews={reviews} />);

    const items = screen.getAllByLabelText(/^\d 分$/).map(stars => stars.closest('.border-b')!);
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringMatching(/^AAda.*Bright and sturdy$/), expect.stringMatching(/^BBo.*Too small$/),
    ]);
    expect(screen.getAllByLabelText(/^\d 分$/).map(stars => stars.getAttribute('aria-label'))).toEqual(['4 分', '2 分']);
    // Unearned stars are greyed out.
    const greyed = (index: number) => screen.getAllByLabelText(/^\d 分$/)[index].querySelectorAll('svg.text-gray-200').length;
    expect([greyed(0), greyed(1)]).toEqual([1, 3]);
    expect(screen.queryByText('暂无评价')).not.toBeInTheDocument();
  });

  it('says when there are no reviews yet', () => {
    render(<ProductReviewList reviews={[]} />);
    expect(screen.getByText('暂无评价')).toBeInTheDocument();
  });
});

describe('related products', () => {
  it('shows a card for each recommendation', () => {
    render(<RelatedProducts products={related} loading={false} />);
    expect(screen.getByRole('heading', { name: '相关推荐' })).toBeInTheDocument();
    expect(screen.getByText('Desk lamp')).toBeInTheDocument();
    expect(screen.getByText('Floor lamp')).toBeInTheDocument();
  });

  it('shows a loading note while recommendations refresh', () => {
    render(<RelatedProducts products={related} loading />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByText('Desk lamp')).not.toBeInTheDocument();
  });

  it('renders nothing without recommendations', () => {
    const { container } = render(<RelatedProducts products={[]} loading={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
