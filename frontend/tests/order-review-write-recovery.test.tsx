import { act, fireEvent, screen, within } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderReviews from '@/components/OrderReviews';
import api, { type PurchaseReview } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, reactHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const failure = (status?: number) => status === undefined ? new AxiosError('Lost reply', 'ERR_NETWORK') : Object.assign(new Error('Uncertain'), { response: { status, data: {} } });
const saved: PurchaseReview = { review_id: 99, user_id: 1, order_id: 7, product_id: 11, rating: 5, content: 'Original draft' };
async function prepare({ status, applied = true, canonicalReview, malformedSuccess = false, read = async (reviews: PurchaseReview[]) => ({ reviews, totalPages: reviews.length ? 1 : 0 }) }: {
  status?: number; applied?: boolean; canonicalReview?: PurchaseReview; malformedSuccess?: boolean; read?: (reviews: PurchaseReview[]) => Promise<unknown>;
} = {}) {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-one');
  let canonical: PurchaseReview[] = [], gets = 0, writes = 0;
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get') {
      gets++; data = useAuthStore.getState().user?.user_id === 2 ? { reviews: [], totalPages: 0 }
        : gets === 1 ? { reviews: [], totalPages: 0 } : await read([...canonical]);
    } else {
      writes++; if (applied) canonical = [canonicalReview ?? { ...saved, ...JSON.parse(config.data) }];
      if (!malformedSuccess) throw failure(status);
      data = { review_id: 0 };
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
  it.each([
    { status: undefined, canonicalReview: { ...saved, rating: 1 } },
    { status: 408, canonicalReview: { ...saved, content: 'A different tab wrote this' } },
    { status: 429, canonicalReview: { ...saved, content: 'Original draft ' } },
    { status: 500, canonicalReview: { ...saved, rating: 4, content: null } },
  ])('keeps the submitted draft visible when recovery finds a different review after status $status', async options => {
    const fixture = await prepare(options);
    const staleSubmit = captureHandler(document.querySelector('form')!, 'onSubmit');
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('已保存的评价与本页提交内容不同，已保留本页草稿，请核对');
    expect(screen.queryByText('评论成功')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交评价' })).not.toBeInTheDocument();
    const retained = within(screen.getByRole('group', { name: '本页提交的评价草稿' }));
    expect(retained.getByText('5分')).toBeInTheDocument();
    expect(retained.getByRole('textbox', { name: '本页提交的评价内容' })).toHaveValue('Original draft');
    expect(retained.getByRole('textbox')).toHaveAttribute('readonly');
    await staleSubmit(); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
  });
  it('compares the submission when a malformed success response requires a read', async () => {
    const fixture = await prepare({ malformedSuccess: true, canonicalReview: { ...saved, rating: 1, content: 'Another tab' } });
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('已保存的评价与本页提交内容不同');
    expect(screen.getByRole('textbox', { name: '本页提交的评价内容' })).toHaveValue('Original draft');
    expect(screen.queryByText('评论成功')).not.toBeInTheDocument();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
  });
  it('keeps the original submission for a later successful recovery read', async () => {
    let recover = false;
    const fixture = await prepare({ canonicalReview: { ...saved, rating: 1, content: 'Another tab' }, read: async reviews => {
      if (!recover) throw failure();
      return { reviews, totalPages: 1 };
    } });
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('评价结果尚未确认');
    recover = true; fireEvent.click(screen.getByRole('button', { name: '重新加载评价' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('已保存的评价与本页提交内容不同');
    expect(screen.getByRole('textbox', { name: '本页提交的评价内容' })).toHaveValue('Original draft');
    expect(fixture.counts()).toEqual({ gets: 3, writes: 1 });
  });
  it('shows the retained conflict draft and notice in English', async () => {
    await prepare({ canonicalReview: { ...saved, rating: 1, content: 'Another tab' } });
    useLocaleStore.getState().setLocale('en'); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The saved review differs from this page\'s submission. Your draft was kept; check the saved review.');
    expect(screen.getByRole('group', { name: 'Draft submitted from this page' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Review content submitted from this page' })).toHaveValue('Original draft');
    expect(screen.queryByText('Review submitted successfully')).not.toBeInTheDocument();
  });
  it('preserves the submitted draft for a definite duplicate response even if its content matches', async () => {
    const fixture = await prepare({ status: 409 }); fireEvent.click(submit()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('评论已存在，请勿重复提交');
    expect(screen.getByRole('textbox', { name: '本页提交的评价内容' })).toHaveValue('Original draft');
    expect(screen.queryByText('评论成功')).not.toBeInTheDocument();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
  });
  it.each([undefined, 408, 429, 500])('rereads a saved review after status %s without a second POST', async status => {
    const fixture = await prepare({ status }); fireEvent.click(submit()); await settle();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
    expect(screen.getByText(/^已评价 ·/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('评论成功');
    expect(screen.queryByRole('group', { name: '本页提交的评价草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交评价' })).not.toBeInTheDocument();
  });
  it.each([null, ''])('matches the actual submitted rating and normalized empty content %j', async content => {
    const fixture = await prepare({ canonicalReview: { ...saved, rating: 1, content } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' \n \t ' } });
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('status')).toHaveTextContent('评论成功');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '本页提交的评价草稿' })).not.toBeInTheDocument();
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
  });
  it('retains the normalized submitted content independently of stale edit events', async () => {
    const response = deferred<unknown>();
    const fixture = await prepare({ read: () => response.promise });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  本页草稿\n第二行  ' } });
    const staleEdit = reactHandler(screen.getByRole('textbox'), 'onChange');
    fireEvent.click(submit()); await settle();
    act(() => staleEdit({ target: { value: 'Changed after submission' } }));
    response.resolve({ reviews: [saved], totalPages: 1 }); await settle();
    const retained = within(screen.getByRole('group', { name: '本页提交的评价草稿' }));
    expect(retained.getByText('1分')).toBeInTheDocument();
    expect(retained.getByRole('textbox')).toHaveValue('本页草稿\n第二行');
    expect(fixture.counts()).toEqual({ gets: 2, writes: 1 });
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
    response.resolve({ reviews: [{ ...saved, rating: 1, content: 'Another tab' }], totalPages: 1 }); await settle();
    expect(screen.queryByText(/^已评价 ·/)).not.toBeInTheDocument(); expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByRole('group', { name: '本页提交的评价草稿' })).not.toBeInTheDocument();
  });
  it('clears a displayed conflict draft when the buyer session changes', async () => {
    await prepare({ canonicalReview: { ...saved, rating: 1, content: 'Another tab' } });
    fireEvent.click(submit()); await settle();
    expect(screen.getByRole('group', { name: '本页提交的评价草稿' })).toBeInTheDocument();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'buyer-two')); await settle();
    expect(screen.queryByRole('group', { name: '本页提交的评价草稿' })).not.toBeInTheDocument();
    expect(screen.queryByText('Another tab')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('shows an English recovery failure', async () => {
    await prepare({ read: async () => { throw failure(); } }); useLocaleStore.getState().setLocale('en'); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Your review result is unconfirmed. Reload reviews before continuing.');
  });
});
