import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import ProductCard from '@/components/ProductCard';
import api, { productApi, recommendationApi, reviewApi, favoriteApi, browseApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { CommitLog, clickTogether, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({ id: navigation.id }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0, review_count: 0 };
const pageData = (page = 1, total = 12) => ({
  reviews: Array.from({ length: Math.min(5, Math.max(0, total - (page - 1) * 5)) }, (_, i) => ({
    review_id: (page - 1) * 5 + i + 1, rating: 4, content: `Review ${(page - 1) * 5 + i + 1}`,
    username: 'Synthetic', created_at: '2026-10-07T12:00:00Z',
  })), total, totalPages: Math.ceil(total / 5), page, limit: 5,
});
const reviewSection = () => screen.getByRole('heading', { name: '用户评价' }).parentElement!;
beforeEach(() => {
  navigation.id = '1';
  useAuthStore.setState({ isHydrated: true });
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unexpected outbound request'));
  vi.spyOn(productApi, 'getDetail').mockImplementation(async id => ({ product: { ...product, product_id: id } }));
  vi.spyOn(recommendationApi, 'getRelated').mockResolvedValue({ related_products: [] });
  vi.spyOn(favoriteApi, 'check').mockResolvedValue({ is_favorited: false });
  vi.spyOn(browseApi, 'record').mockResolvedValue({} as never);
  vi.spyOn(reviewApi, 'listByProduct').mockResolvedValue(pageData());
});

describe('product review recovery and pagination', () => {
  it('shows loading instead of a false empty state until reviews arrive', async () => {
    const pending = deferred<ReturnType<typeof pageData>>();
    vi.mocked(reviewApi.listByProduct).mockReturnValueOnce(pending.promise);
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(reviewSection()).getByText('加载中...')).toBeVisible();
    expect(within(reviewSection()).queryByText('暂无评价')).toBeNull();
    await act(async () => pending.resolve(pageData()));
    expect(screen.getByText('Review 1')).toBeVisible();
  });

  it('a failed review request can retry without refreshing inventory or recording a browse', async () => {
    vi.mocked(reviewApi.listByProduct).mockRejectedValueOnce(new Error('503'));
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(reviewSection()).getByRole('alert')).toHaveTextContent('加载评价失败，请重试');
    expect(within(reviewSection()).queryByText('暂无评价')).toBeNull();
    clickTogether(within(reviewSection()).getByRole('button', { name: '重新加载' }), within(reviewSection()).getByRole('button', { name: '重新加载' }));
    await settle();
    expect(screen.getByText('Review 1')).toBeVisible();
    expect(reviewApi.listByProduct).toHaveBeenCalledTimes(2);
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
    expect(browseApi.record).not.toHaveBeenCalled();
  });

  it('all twelve reviews can be reached with five reviews per page and no duplicate next-page requests', async () => {
    vi.mocked(reviewApi.listByProduct).mockImplementation(async (_id, params) => pageData((params as { page: number }).page));
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByText('Review 1')).toBeVisible();
    expect(within(reviewSection()).getByRole('button', { name: '上一页' })).toBeDisabled();
    clickTogether(within(reviewSection()).getByRole('button', { name: '下一页' }), within(reviewSection()).getByRole('button', { name: '下一页' }));
    await settle();
    expect(screen.getByText('Review 6')).toBeVisible();
    expect(screen.queryByText('Review 1')).toBeNull();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '下一页' })); await settle();
    expect(screen.getByText('Review 12')).toBeVisible();
    expect(within(reviewSection()).getByRole('button', { name: '下一页' })).toBeDisabled();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '上一页' })); await settle();
    expect(screen.getByText('Review 6')).toBeVisible();
    expect(vi.mocked(reviewApi.listByProduct).mock.calls.map(([, params]) => params)).toEqual([
      { page: 1, limit: 5 }, { page: 2, limit: 5 }, { page: 3, limit: 5 }, { page: 2, limit: 5 },
    ]);
  });

  it('a failed next page retries that same page, preserving pagination context', async () => {
    vi.mocked(reviewApi.listByProduct).mockResolvedValueOnce(pageData()).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(pageData(2));
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '下一页' })); await settle();
    expect(within(reviewSection()).getByRole('alert')).toBeVisible();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '重新加载' })); await settle();
    expect(screen.getByText('Review 6')).toBeVisible();
    expect(reviewApi.listByProduct).toHaveBeenLastCalledWith(1, { page: 2, limit: 5 });
  });

  it('empty successful responses show the real empty state', async () => {
    vi.mocked(reviewApi.listByProduct).mockResolvedValueOnce(pageData(1, 0));
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(within(reviewSection()).getByText('暂无评价')).toBeVisible();
    expect(within(reviewSection()).queryByRole('alert')).toBeNull();
    expect(within(reviewSection()).queryByRole('button', { name: '下一页' })).toBeNull();
  });

  it('product changes reset page one before any commit can display old reviews and ignore late old results', async () => {
    const late = deferred<ReturnType<typeof pageData>>();
    vi.mocked(reviewApi.listByProduct).mockResolvedValueOnce(pageData()).mockReturnValueOnce(late.promise).mockResolvedValueOnce({ ...pageData(1, 1), reviews: [{ ...pageData().reviews[0], content: 'New product review' }] });
    const commits: HTMLElement[] = [];
    const view = render(<CommitLog commits={commits}><ProductDetail initialProduct={product} /></CommitLog>); await settle();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '下一页' })); await settle();
    commits.length = 0;
    navigation.id = '2';
    view.rerender(<CommitLog commits={commits}><ProductDetail initialProduct={{ ...product, product_id: 2 }} /></CommitLog>); await settle();
    expect(commits.every(node => !node.textContent?.includes('Review 1'))).toBe(true);
    expect(reviewApi.listByProduct).toHaveBeenLastCalledWith(2, { page: 1, limit: 5 });
    await act(async () => late.resolve(pageData(2)));
    expect(screen.getByText('New product review')).toBeVisible();
    expect(screen.queryByText('Review 6')).toBeNull();
  });

  it('reviews shrinking on a later page redirect to the last available page', async () => {
    vi.mocked(reviewApi.listByProduct).mockResolvedValueOnce(pageData()).mockResolvedValueOnce(pageData(2, 1)).mockResolvedValueOnce(pageData(1, 1));
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(within(reviewSection()).getByRole('button', { name: '下一页' })); await settle();
    expect(screen.getByText('Review 1')).toBeVisible();
    expect(reviewApi.listByProduct).toHaveBeenLastCalledWith(1, { page: 1, limit: 5 });
  });
});

describe('actual product ratings', () => {
  it('unreviewed cards say no reviews in both languages instead of showing a zero-star score', () => {
    const view = render(<ProductCard product={product} />);
    expect(screen.getByText('暂无评价')).toBeVisible();
    act(() => useLocaleStore.setState({ locale: 'en' }));
    view.rerender(<ProductCard product={product} />);
    expect(screen.getByText('No reviews yet')).toBeVisible();
  });
});
