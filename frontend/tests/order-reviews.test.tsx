import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderReviews from '@/components/OrderReviews';
import api, { type PurchaseReview } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { captureHandler, deferred, reactHandler, settle, submitTogether } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

type Item = { product_id: number; product_name: string };
type ListResponse = { reviews: PurchaseReview[]; totalPages: number };
type SaveBody = { order_id: number; product_id: number; rating: number; content: string };
interface Request { method?: string; url?: string; params?: unknown; body?: SaveBody; authorization: unknown }

const buyer = { user_id: 1, username: 'one', email: 'one@example.test' };
const otherBuyer = { user_id: 2, username: 'two', email: 'two@example.test' };
const products: Item[] = [
  { product_id: 11, product_name: '中文原始商品' },
  { product_id: 11, product_name: '中文原始商品' },
  { product_id: 12, product_name: '另一商品' },
];
const savedReview = (product_id = 11, content = '已保存的原文', user_id = 1, order_id = 7): PurchaseReview =>
  ({ review_id: product_id, product_id, user_id, order_id, rating: 4, content, created_at: '2026-10-04T10:00:00Z' });
const failure = (status: number, error: string) => Object.assign(new Error(error), { response: { status, data: { error } } });

let requests: Request[] = [];
const originalAdapter = api.defaults.adapter;
const posts = () => requests.filter(request => request.method === 'post');
const gets = () => requests.filter(request => request.method === 'get');

interface Setup {
  list?: (params: { page: number }) => Promise<ListResponse> | ListResponse;
  save?: (body: SaveBody) => Promise<unknown>;
  locale?: Locale;
}

/**
 * Signs the buyer in and answers the real API client at the transport layer, so requests
 * keep their URL, parameters, body and Authorization header.
 */
function prepare({ list = async () => ({ reviews: [], totalPages: 0 }), save = async () => ({ review_id: 99 }), locale = 'zh-CN' }: Setup = {}) {
  useAuthStore.getState().login(buyer, 'buyer-one');
  useLocaleStore.getState().setLocale(locale);
  const adapter: AxiosAdapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, params: config.params, body, authorization: config.headers.get('Authorization') });
    const data = config.method === 'get' ? await list(config.params) : await save(body);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
}

async function renderReviews(items: Item[] = products, orderId = 7) {
  const view = render(<OrderReviews orderId={orderId} items={items} />);
  await settle();
  return view;
}

const forms = () => Array.from(document.querySelectorAll('form'));
const ratingOf = (form: HTMLElement) => within(form).getByRole<HTMLSelectElement>('combobox');
const contentOf = (form: HTMLElement) => within(form).getByRole<HTMLTextAreaElement>('textbox');

async function submit(form: HTMLFormElement) {
  fireEvent.submit(form);
  await settle();
}

describe('order reviews', () => {
  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('deduplicates SKUs into one form per product and submits only the selected purchased product', async () => {
    prepare();
    await renderReviews();
    expect(forms()).toHaveLength(2);

    fireEvent.change(ratingOf(forms()[0]), { target: { value: '4' } });
    fireEvent.change(contentOf(forms()[0]), { target: { value: '  实际评价内容  ' } });
    await submit(forms()[0]);

    expect(requests[0].params).toEqual({ order_id: 7, page: 1, limit: 100 });
    expect(requests[1]).toEqual({ method: 'post', url: '/reviews', params: undefined, authorization: 'Bearer buyer-one',
      body: { order_id: 7, product_id: 11, rating: 4, content: '实际评价内容' } });
    expect(forms()).toHaveLength(1);
    expect(screen.getByText('实际评价内容')).toBeInTheDocument();
    expect(screen.getByText(/已评价/)).toBeInTheDocument();
  });

  it('switches labels and the saved status to English while buyer text stays literal', async () => {
    prepare({ locale: 'en' });
    await renderReviews();
    expect(screen.getByRole('heading', { name: 'Order reviews' })).toBeInTheDocument();
    expect(screen.getByText('中文原始商品')).toBeInTheDocument();

    await submit(forms()[0]);

    expect(screen.getByText(/Reviewed/)).toBeInTheDocument();
    expect(screen.getByText('Review submitted successfully')).toBeInTheDocument();
  });

  it('loads every page of the current order before any review form becomes available', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({ product_id: index + 1, product_name: `商品${index + 1}` }));
    const last = deferred<ListResponse>();
    prepare({ list: ({ page }) => page === 1 ? { reviews: items.slice(0, 100).map(item => savedReview(item.product_id)), totalPages: 2 } : last.promise });
    await renderReviews(items);
    expect(forms()).toHaveLength(0);
    expect(screen.getByText('订单评价加载中...')).toBeInTheDocument();

    await act(async () => last.resolve({ reviews: [savedReview(101, '第二页已有评价')], totalPages: 2 }));
    await settle();

    expect(forms()).toHaveLength(0);
    expect(screen.getByText('第二页已有评价')).toBeInTheDocument();
    expect(requests.map(request => request.params)).toEqual([{ order_id: 7, page: 1, limit: 100 }, { order_id: 7, page: 2, limit: 100 }]);
  });

  it.each([
    ['a failed request', new Error('offline')],
    ["another customer's review", { reviews: [savedReview(11, '他人秘密', 2)], totalPages: 1 }],
    ["another order's review", { reviews: [savedReview(11, '其他订单', 1, 8)], totalPages: 1 }],
    ['an impossible page count', { reviews: [], totalPages: 9 }],
    ['a product not in the order', { reviews: [savedReview(99)], totalPages: 1 }],
  ])('offers a retry instead of a false empty state after %s', async (_, firstResponse) => {
    let count = 0;
    prepare({ list: async () => {
      if (++count > 1) return { reviews: [savedReview()], totalPages: 1 };
      if (firstResponse instanceof Error) throw firstResponse;
      return firstResponse;
    } });
    await renderReviews();

    expect(forms()).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('加载订单评价失败，请重试');
    expect(screen.queryByText('他人秘密')).not.toBeInTheDocument();
    expect(screen.queryByText('其他订单')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新加载评价' }));
    await settle();
    expect(screen.getByText('已保存的原文')).toBeInTheDocument();
    expect(forms()).toHaveLength(1);
  });

  it('blocks repeated submissions and every other product while saving, and keeps the draft on failure', async () => {
    const pending = deferred();
    prepare({ save: () => pending.promise });
    await renderReviews();
    fireEvent.change(contentOf(forms()[0]), { target: { value: '需要保留的草稿' } });
    const [first, second] = forms();

    submitTogether(first, first, second);
    await settle();

    expect(posts()).toHaveLength(1);
    for (const control of Array.from(document.querySelectorAll('select, textarea, button'))) expect(control).toBeDisabled();

    act(() => useLocaleStore.getState().setLocale('en'));
    await act(async () => pending.reject(failure(500, '创建评论失败')));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to submit your review');
    expect(contentOf(forms()[0])).toHaveValue('需要保留的草稿');
    expect(screen.getAllByRole('button', { name: 'Submit review' })[0]).toBeEnabled();
  });

  it('reloads the canonical saved review after a concurrent duplicate, and it survives a remount', async () => {
    let count = 0;
    prepare({
      list: async () => ({ reviews: ++count > 1 ? [savedReview(11, '服务器已存在评价')] : [], totalPages: count > 1 ? 1 : 0 }),
      save: async () => { throw failure(409, '评论已存在，请勿重复提交'); },
    });
    const view = await renderReviews();

    await submit(forms()[0]);
    expect(screen.getByText('服务器已存在评价')).toBeInTheDocument();
    expect(forms()).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('评论已存在，请勿重复提交');

    view.unmount();
    prepare({ list: async () => ({ reviews: [savedReview(11, '服务器已存在评价')], totalPages: 1 }) });
    await renderReviews();
    expect(forms()).toHaveLength(1);
    expect(screen.getByText('服务器已存在评价')).toBeInTheDocument();
  });

  it('rejects invalid ratings and content and accepts the 2000 character boundary', async () => {
    prepare();
    await renderReviews();
    for (const [rating, content] of [['6', ''], ['2.5', ''], ['01', ''], ['5', 'x'.repeat(2001)]]) {
      // The select offers only 1-5; a tampered value must still be refused.
      act(() => { reactHandler(ratingOf(forms()[0]), 'onChange')({ target: { value: rating } }); });
      fireEvent.change(contentOf(forms()[0]), { target: { value: content } });
      await submit(forms()[0]);

      expect(screen.getByRole('alert')).toHaveTextContent('评分须为1至5分');
      expect(posts()).toHaveLength(0);
    }

    fireEvent.change(ratingOf(forms()[0]), { target: { value: '1' } });
    fireEvent.change(contentOf(forms()[0]), { target: { value: '中'.repeat(2000) } });
    await submit(forms()[0]);
    expect(requests[1].body?.content).toHaveLength(2000);
    expect(requests[1].body?.rating).toBe(1);
  });

  it.each(['hydration', 'logout', 'empty', 'storage'] as const)('renders nothing and requests no private reviews when %s rules them out', async (scenario) => {
    prepare();
    if (scenario === 'hydration') useAuthStore.setState({ isHydrated: false });
    if (scenario === 'logout') useAuthStore.getState().logout();
    if (scenario === 'storage') vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });

    const { container } = await renderReviews(scenario === 'empty' ? [] : products);

    expect(container).toBeEmptyDOMElement();
    expect(requests).toHaveLength(0);
  });

  it.each(['account', 'token', 'order', 'storage', 'storage-user', 'unmount'] as const)('never reveals a late read after a %s change', async (scenario) => {
    const old = deferred<ListResponse>();
    let calls = 0;
    prepare({ list: () => ++calls === 1 ? old.promise : Promise.resolve({ reviews: [], totalPages: 0 }) });
    const view = await renderReviews();

    if (scenario === 'account') act(() => useAuthStore.getState().login(otherBuyer, 'buyer-two'));
    if (scenario === 'token') act(() => useAuthStore.getState().login(buyer, 'renewed'));
    if (scenario === 'order') view.rerender(<OrderReviews orderId={8} items={products} />);
    if (scenario === 'storage') localStorage.setItem('token', 'different');
    if (scenario === 'storage-user') localStorage.setItem('user', JSON.stringify({ user_id: 2 }));
    if (scenario === 'unmount') view.unmount();
    await settle();
    await act(async () => old.resolve({ reviews: [savedReview(11, '旧账户秘密')], totalPages: 1 }));
    await settle();

    expect(screen.queryByText('旧账户秘密')).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('does not submit after another browser tab changes the token', async () => {
    prepare();
    await renderReviews();
    localStorage.setItem('token', 'another-tab');

    await submit(forms()[0]);

    expect(requests).toHaveLength(1);
  });

  it.each(['success', 'failure'] as const)("cannot let customer A's late save %s change customer B's pending save, drafts or notices", async (outcome) => {
    const old = deferred(), current = deferred();
    let count = 0;
    prepare({ save: () => ++count === 1 ? old.promise : current.promise });
    await renderReviews();
    fireEvent.submit(forms()[0]);

    act(() => useAuthStore.getState().login(otherBuyer, 'buyer-two'));
    await settle();
    fireEvent.submit(forms()[0]);
    await act(async () => {
      if (outcome === 'success') old.resolve({ review_id: 88 });
      else old.reject(failure(409, '旧保存失败'));
    });
    await settle();

    expect(forms()).toHaveLength(2);
    expect(screen.queryByText('旧保存失败')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    expect(gets()).toHaveLength(2);

    await act(async () => current.resolve({ review_id: 89 }));
    await settle();
    expect(forms()).toHaveLength(1);
    expect(screen.getByText('评论成功')).toBeInTheDocument();
  });

  it("cannot reload during a save through an obsolete retry handler or erase another product's saved review", async () => {
    let count = 0;
    const pending = deferred();
    prepare({
      list: async () => {
        if (++count === 1) throw new Error('offline');
        return { reviews: [savedReview(12, '另一商品的已保存评价')], totalPages: 1 };
      },
      save: () => pending.promise,
    });
    await renderReviews();
    const retry = captureHandler(screen.getByRole('button', { name: '重新加载评价' }));

    await act(() => retry());
    await settle();
    fireEvent.submit(forms()[0]);
    await retry();
    expect(count).toBe(2);

    await act(async () => pending.resolve({ review_id: 90 }));
    await settle();
    expect(forms()).toHaveLength(0);
    expect(screen.getByText('另一商品的已保存评价')).toBeInTheDocument();
  });
});
