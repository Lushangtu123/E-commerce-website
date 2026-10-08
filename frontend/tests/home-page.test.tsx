import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/components/HomePage';
import { productApi, recommendationApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { CommitLog, deferred, render, settle } from './helpers';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { toasts.push(message); }, success: vi.fn() };
  return { default: toast, toast };
});
// Cards have their own tests; here each one only names its product.
vi.mock('@/components/ProductCard', () => ({
  default: ({ product }: { product: Product }) => <div data-testid="product-card">{product.product_id}</div>,
  ProductCardSkeleton: () => <div data-testid="product-skeleton" />,
}));
vi.mock('@/lib/api', () => ({
  productApi: { getHotProducts: vi.fn(), list: vi.fn() },
  recommendationApi: { getGuessYouLike: vi.fn() },
}));

type Recommendations = Awaited<ReturnType<typeof recommendationApi.getGuessYouLike>>;
const product = (id: number): Product => ({ product_id: id, title: `Product ${id}`, price: id, stock: 1, sales_count: 0, rating: 5 });

async function setup({ hot = async () => ({ products: [product(1)] }), recommend = async () => ({ recommendations: [] }) }: {
  hot?: () => Promise<unknown>;
  recommend?: () => Promise<Recommendations>;
} = {}) {
  vi.mocked(productApi.getHotProducts).mockImplementation(hot as never);
  vi.mocked(productApi.list).mockResolvedValue({ products: [product(2)] } as never);
  vi.mocked(recommendationApi.getGuessYouLike).mockImplementation(recommend);
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><HomePage /></CommitLog>);
  await settle();
  return { view, commits };
}

/** A product section by its heading, or null when the section is not rendered. */
function section(title: string) {
  const heading = screen.queryByRole('heading', { level: 2, name: title });
  return heading ? heading.closest('section') : null;
}
const ids = (title: string) => within(section(title)!).queryAllByTestId('product-card').map(card => Number(card.textContent));
const loading = (title: string) => within(section(title)!).queryAllByTestId('product-skeleton').length > 0;
const signIn = () => act(() => useAuthStore.getState().login({ user_id: 1, username: 'customer', email: 'customer@example.test' }, 'session'));

describe('home page', () => {
  beforeEach(() => {
    toasts.length = 0;
  });

  it('shows hot and new products and hides empty recommendations', async () => {
    await setup();

    expect(ids('热门商品')).toEqual([1]);
    expect(ids('新品推荐')).toEqual([2]);
    expect(loading('热门商品')).toBe(false);
    expect(section('猜你喜欢')).toBeNull();
    expect(toasts).toEqual([]);
  });

  it('keeps new products when the hot product request fails', async () => {
    await setup({ hot: async () => { throw new Error('offline'); } });

    expect(ids('热门商品')).toEqual([]);
    expect(ids('新品推荐')).toEqual([2]);
    expect(loading('新品推荐')).toBe(false);
    expect(toasts).toEqual(['加载数据失败']);
  });

  it('cannot let an older recommendation response replace the one for the signed-in session', async () => {
    const pending = [deferred<Recommendations>(), deferred<Recommendations>()];
    let calls = 0;
    await setup({ recommend: () => pending[calls++].promise });

    signIn();
    await settle();
    expect(calls).toBe(2);
    await act(async () => pending[1].resolve({ recommendations: [product(7)] }));
    await settle();
    await act(async () => pending[0].resolve({ recommendations: [product(9)] }));
    await settle();

    expect(ids('猜你喜欢')).toEqual([7]);
    expect(within(section('猜你喜欢')!).getByText('基于您的浏览历史为您推荐')).toBeInTheDocument();
    expect(loading('猜你喜欢')).toBe(false);
  });

  it('describes recommendations by the session they were fetched for and clears them when the latest request fails', async () => {
    let fail = false;
    await setup({ recommend: async () => {
      if (fail) throw new Error('offline');
      return { recommendations: [product(5)] };
    } });
    expect(within(section('猜你喜欢')!).getByText('热门商品推荐')).toBeInTheDocument();

    fail = true;
    signIn();
    await settle();

    expect(ids('猜你喜欢'), 'generic picks must not stay labelled as personal ones').toEqual([]);
    expect(within(section('猜你喜欢')!).getByRole('alert')).toHaveTextContent('加载推荐失败，请重试');
    expect(within(section('猜你喜欢')!).getByRole('button', { name: '重新加载' })).toBeVisible();
  });

  it('hides the previous account\'s recommendations in the next account\'s first render', async () => {
    signIn();
    const next = deferred<Recommendations>();
    let calls = 0;
    const { commits } = await setup({ recommend: () => ++calls === 1 ? Promise.resolve({ recommendations: [product(7)] }) : next.promise });
    expect(ids('猜你喜欢')).toEqual([7]);
    const before = commits.length;

    act(() => useAuthStore.getState().login({ user_id: 2, username: 'second', email: 'second@example.test' }, 'second-session'));

    expect(within(commits[before]).queryAllByTestId('product-card').map(card => card.textContent)).not.toContain('7');
    await settle();
    expect(calls).toBe(2);
    await act(async () => next.resolve({ recommendations: [product(9)] }));
    await settle();
    expect(ids('猜你喜欢')).toEqual([9]);
  });

  it.each(['success', 'failure'] as const)('ignores a late previous-account recommendation %s after an authenticated account switch', async (outcome) => {
    signIn();
    const pending = [deferred<Recommendations>(), deferred<Recommendations>()];
    let calls = 0;
    await setup({ recommend: () => pending[calls++].promise });

    act(() => useAuthStore.getState().login({ user_id: 2, username: 'second', email: 'second@example.test' }, 'second-session'));
    await settle();
    expect(calls).toBe(2);
    await act(async () => pending[1].resolve({ recommendations: [product(9)] }));
    await settle();
    await act(async () => {
      if (outcome === 'success') pending[0].resolve({ recommendations: [product(7)] });
      else pending[0].reject(new Error('Old account unavailable'));
    });
    await settle();

    expect(ids('猜你喜欢')).toEqual([9]);
    expect(within(section('猜你喜欢')!).getByText('基于您的浏览历史为您推荐')).toBeInTheDocument();
  });

  it('hides signed-in recommendations immediately on logout and displays the anonymous response as generic', async () => {
    signIn();
    const anonymous = deferred<Recommendations>();
    let calls = 0;
    const { commits } = await setup({ recommend: () => ++calls === 1 ? Promise.resolve({ recommendations: [product(7)] }) : anonymous.promise });
    const before = commits.length;

    act(() => useAuthStore.getState().logout());

    expect(within(commits[before]).queryAllByTestId('product-card').map(card => card.textContent)).not.toContain('7');
    await settle();
    await act(async () => anonymous.resolve({ recommendations: [product(5)] }));
    await settle();
    expect(ids('猜你喜欢')).toEqual([5]);
    expect(within(section('猜你喜欢')!).getByText('热门商品推荐')).toBeInTheDocument();
  });

  it('rejects a recommendation response when browser storage changes before the auth store catches up', async () => {
    signIn();
    const pending = deferred<Recommendations>();
    await setup({ recommend: () => pending.promise });
    localStorage.setItem('session', 'another-session');

    await act(async () => pending.resolve({ recommendations: [product(7)] }));
    await settle();

    expect(section('猜你喜欢')).toBeNull();
  });
});
