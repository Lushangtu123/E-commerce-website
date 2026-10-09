import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderReviews from '@/components/OrderReviews';
import api, { type PurchaseReview } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const failure = (status?: number) => status === undefined ? new AxiosError('Lost reply', 'ERR_NETWORK') : Object.assign(new Error('Uncertain'), { response: { status, data: {} } });
const saved: PurchaseReview = { review_id: 99, user_id: 1, order_id: 7, product_id: 11, rating: 5, content: 'Original draft' };
async function prepare({ status, applied = true, read = async (reviews: PurchaseReview[]) => ({ reviews, totalPages: reviews.length ? 1 : 0 }) }: {
  status?: number; applied?: boolean; read?: (reviews: PurchaseReview[]) => Promise<unknown>;
} = {}) {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-one');
  let canonical: PurchaseReview[] = [], gets = 0, writes = 0;
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get') {
      gets++; data = useAuthStore.getState().user?.user_id === 2 ? { reviews: [], totalPages: 0 }
        : gets === 1 ? { reviews: [], totalPages: 0 } : await read([...canonical]);
    } else {
      writes++; if (applied) canonical = [{ ...saved, ...JSON.parse(config.data) }]; throw failure(status);
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<OrderReviews orderId={7} items={[{ product_id: 11, product_name: 'Recovery product' }]} />); await settle();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original draft' } }); await settle();
  return { view, counts: () => ({ gets, writes }) };
}
const submit = () => screen.getByRole('button', { name: '提交评价' });

describe('order review uncertain write recovery', () => {
  it.each([undefined, 408, 429, 500])('rereads a saved review after status %s without a second POST', async status => {
    const fixture = await prepare({ status }); fireEvent.click(submit()); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
    expect(screen.getByText(/^已评价 ·/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交评价' })).not.toBeInTheDocument();
  });
  it('retains the original draft when the read confirms the write did not apply', async () => {
    await prepare({ applied: false }); fireEvent.click(submit()); await settle();
    expect(screen.getByRole('textbox')).toHaveValue('Original draft'); expect(submit()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('评价尚未保存，已保留草稿，请检查后重试');
  });
  it('blocks stale form submissions and uses only GET for recovery retries', async () => {
    let recover = false;
    const fixture = await prepare({ read: async reviews => { if (!recover) throw failure(); return { reviews, totalPages: 1 }; } });
    const staleSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('评价结果尚未确认，请重新加载评价后再操作');
    await staleSubmit(); await settle(); expect(fixture.counts().writes).toBe(1);
    recover = true; fireEvent.click(screen.getByRole('button', { name: '重新加载评价' })); await settle();
    expect(fixture.counts()).toEqual({ gets: 3, writes: 1 }); expect(screen.getByText(/^已评价 ·/)).toBeInTheDocument();
  });
  it.each([{ reviews: [{ ...saved, user_id: 2 }], totalPages: 1 }, { reviews: [{ ...saved, review_id: 0 }], totalPages: 1 }, {}])('keeps a malformed recovery response blocked %j', async data => {
    const fixture = await prepare({ read: async () => data }); fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('评价结果尚未确认'); expect(fixture.counts().writes).toBe(1);
  });
  it('leaves a deterministic validation error editable without rereading', async () => {
    const fixture = await prepare({ status: 400, applied: false }); fireEvent.click(submit()); await settle();
    expect(fixture.counts()).toEqual({ gets: 1, writes: 1 }); expect(submit()).toBeEnabled();
  });
  it('ignores the previous buyer recovery response after an account switch', async () => {
    const response = deferred<unknown>(); await prepare({ read: () => response.promise }); fireEvent.click(submit()); await settle();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'buyer-two')); await settle();
    response.resolve({ reviews: [saved], totalPages: 1 }); await settle();
    expect(screen.queryByText(/^已评价 ·/)).not.toBeInTheDocument(); expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('shows an English recovery failure', async () => {
    await prepare({ read: async () => { throw failure(); } }); useLocaleStore.getState().setLocale('en'); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Your review result is unconfirmed. Reload reviews before continuing.');
  });
});
