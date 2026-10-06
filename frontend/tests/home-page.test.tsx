import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/components/HomePage';
import { productApi, recommendationApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { deferred, settle } from './helpers';

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
  render(<HomePage />);
  await settle();
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

    expect(section('猜你喜欢'), 'generic picks must not stay labelled as personal ones').toBeNull();
  });
});
