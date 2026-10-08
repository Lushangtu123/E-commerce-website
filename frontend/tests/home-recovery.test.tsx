import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import HomePage from '@/components/HomePage';
import { productApi, recommendationApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { CommitLog, captureHandler, deferred, render, settle } from './helpers';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ProductCard', () => ({
  default: ({ product }: { product: Product }) => <div data-testid="product-card">{product.title}</div>,
  ProductCardSkeleton: () => <div data-testid="product-skeleton" />,
}));
vi.mock('@/lib/api', () => ({
  productApi: { getHotProducts: vi.fn(), list: vi.fn() },
  recommendationApi: { getGuessYouLike: vi.fn() },
}));

const product = (title: string): Product => ({ product_id: 1, title, price: 10, stock: 1, sales_count: 0, rating: 5 });
const section = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!;
const cards = (title: string) => within(section(title)).queryAllByTestId('product-card').map(card => card.textContent);
const signIn = (id = 1) => act(() => useAuthStore.getState().login({ user_id: id, username: `User ${id}`, email: `user${id}@example.test` }, `session-${id}`));

function defaults() {
  vi.mocked(productApi.getHotProducts).mockResolvedValue({ products: [product('Hot')] });
  vi.mocked(productApi.list).mockResolvedValue({ products: [product('New')], total: 1, page: 1, limit: 8, totalPages: 1 });
  vi.mocked(recommendationApi.getGuessYouLike).mockResolvedValue({ recommendations: [product('Recommended')] });
}

describe('independent home section recovery', () => {
  beforeEach(() => useAuthStore.getState().hydrate());
  it('switches language without refetching and translates a delayed failure in the latest language', async () => {
    defaults();
    const pending = deferred<Awaited<ReturnType<typeof productApi.getHotProducts>>>();
    vi.mocked(productApi.getHotProducts).mockReturnValue(pending.promise);
    render(<HomePage />);
    await settle();
    act(() => useLocaleStore.getState().setLocale('en'));
    await settle();
    expect(productApi.getHotProducts).toHaveBeenCalledTimes(1);
    expect(productApi.list).toHaveBeenCalledTimes(1);
    expect(recommendationApi.getGuessYouLike).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error('Offline')));
    await settle();
    expect(toast.error).toHaveBeenLastCalledWith('Unable to load data');
    expect(within(section('Best sellers')).getByRole('alert')).toHaveTextContent('Unable to load popular products. Please try again.');
  });
  it('shows a settled section while another is still loading', async () => {
    defaults();
    const latest = deferred<Awaited<ReturnType<typeof productApi.list>>>();
    vi.mocked(productApi.list).mockReturnValue(latest.promise);
    render(<HomePage />);
    await settle();

    expect(cards('热门商品')).toEqual(['Hot']);
    expect(cards('猜你喜欢')).toEqual(['Recommended']);
    expect(within(section('新品推荐')).getAllByTestId('product-skeleton')).toHaveLength(8);
  });

  it.each(['热门商品', '新品推荐', '猜你喜欢'])('retries only a failed %s section and deduplicates immediate retries', async title => {
    defaults();
    const retry = deferred<unknown>();
    if (title === '热门商品') vi.mocked(productApi.getHotProducts).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise as never);
    if (title === '新品推荐') vi.mocked(productApi.list).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise as never);
    if (title === '猜你喜欢') vi.mocked(recommendationApi.getGuessYouLike).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise as never);
    render(<HomePage />);
    await settle();

    const region = section(title);
    expect(within(region).getByRole('alert')).toBeInTheDocument();
    expect(within(region).queryByText('暂无商品')).not.toBeInTheDocument();
    const retryRead = captureHandler(within(region).getByRole('button', { name: '重新加载' }));
    void retryRead();
    void retryRead();
    await settle();
    expect(productApi.getHotProducts).toHaveBeenCalledTimes(title === '热门商品' ? 2 : 1);
    expect(productApi.list).toHaveBeenCalledTimes(title === '新品推荐' ? 2 : 1);
    expect(recommendationApi.getGuessYouLike).toHaveBeenCalledTimes(title === '猜你喜欢' ? 2 : 1);
    expect(within(region).getAllByTestId('product-skeleton')).toHaveLength(8);
    for (const other of ['热门商品', '新品推荐', '猜你喜欢'].filter(value => value !== title)) expect(cards(other)).toHaveLength(1);

    await act(async () => retry.resolve(title === '猜你喜欢' ? { recommendations: [product('Recovered')] } : { products: [product('Recovered')] }));
    await settle();
    expect(cards(title)).toEqual(['Recovered']);
    expect(within(section(title)).queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['热门商品', '新品推荐'])('shows a successful empty %s section without an error or retry', async title => {
    defaults();
    if (title === '热门商品') vi.mocked(productApi.getHotProducts).mockResolvedValue({ products: [] });
    else vi.mocked(productApi.list).mockResolvedValue({ products: [], total: 0, page: 1, limit: 8, totalPages: 0 });
    render(<HomePage />);
    await settle();
    expect(within(section(title)).getByText('暂无商品')).toBeInTheDocument();
    expect(within(section(title)).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(section(title)).queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });

  it('keeps successful empty recommendations hidden, unlike failed recommendations', async () => {
    defaults();
    vi.mocked(recommendationApi.getGuessYouLike).mockResolvedValue({ recommendations: [] });
    render(<HomePage />);
    await settle();
    expect(screen.queryByRole('heading', { name: '猜你喜欢' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)('ignores a late recommendation retry %s after an account switch', async outcome => {
    defaults();
    signIn();
    const retry = deferred<Awaited<ReturnType<typeof recommendationApi.getGuessYouLike>>>();
    vi.mocked(recommendationApi.getGuessYouLike).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ recommendations: [product('Current account')] });
    const commits: HTMLElement[] = [];
    render(<CommitLog commits={commits}><HomePage /></CommitLog>);
    await settle();
    const staleRetry = captureHandler(within(section('猜你喜欢')).getByRole('button', { name: '重新加载' }));
    void staleRetry();
    await settle();
    const before = commits.length;
    signIn(2);
    expect(commits[before].textContent).not.toContain('加载推荐失败，请重试');
    await settle();

    await act(async () => {
      if (outcome === 'success') retry.resolve({ recommendations: [product('Old account')] });
      else retry.reject(new Error('Old account failed'));
    });
    await staleRetry();
    await settle();
    expect(cards('猜你喜欢')).toEqual(['Current account']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(recommendationApi.getGuessYouLike).toHaveBeenCalledTimes(3);
  });

  it.each(['storage', 'unmount'] as const)('ignores late recommendation retry after %s changes', async change => {
    defaults();
    signIn();
    const retry = deferred<Awaited<ReturnType<typeof recommendationApi.getGuessYouLike>>>();
    vi.mocked(recommendationApi.getGuessYouLike).mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
    const view = render(<HomePage />);
    await settle();
    const staleRetry = captureHandler(within(section('猜你喜欢')).getByRole('button', { name: '重新加载' }));
    void staleRetry();
    await settle();
    if (change === 'storage') localStorage.setItem('session', 'other-session');
    else view.unmount();
    await act(async () => retry.resolve({ recommendations: [product('Ignored response')] }));
    await staleRetry();
    await settle();
    expect(screen.queryByText('Ignored response')).not.toBeInTheDocument();
    expect(recommendationApi.getGuessYouLike).toHaveBeenCalledTimes(2);
  });

  it.each(['热门商品', '新品推荐'])('does not report a late public %s failure after unmount', async title => {
    defaults();
    const pending = deferred<unknown>();
    if (title === '热门商品') vi.mocked(productApi.getHotProducts).mockReturnValue(pending.promise as never);
    else vi.mocked(productApi.list).mockReturnValue(pending.promise as never);
    const view = render(<HomePage />);
    await settle();
    view.unmount();
    await act(async () => pending.reject(new Error('Late public error')));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
