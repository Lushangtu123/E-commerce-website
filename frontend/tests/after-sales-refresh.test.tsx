import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import OrderAfterSales from '@/components/OrderAfterSales';
import api, { type AfterSalesRequest } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { captureHandler, deferred, render, settle, submitTogether } from './helpers';

const customer = { user_id: 1, username: 'Customer', email: 'customer@test' };
const row = (status: AfterSalesRequest['status'] = 'requested', extra: Partial<AfterSalesRequest> = {}): AfterSalesRequest =>
  ({ request_id: 7, order_id: 1, type: 'return', reason: 'Damaged', status, ...extra });
type Response = { after_sales: AfterSalesRequest | null };
const originalAdapter = api.defaults.adapter;
// Carry a real HTTP status through the same axios interceptor as production requests.
function httpError(config: InternalAxiosRequestConfig, status: number, error: string) {
  return new AxiosError(error, AxiosError.ERR_BAD_REQUEST, config, undefined,
    { data: { error }, status, statusText: 'Failure', headers: {}, config });
}
async function setup(options: { read?: (id: number, count: number) => Promise<Response>; write?: (config: InternalAxiosRequestConfig) => Promise<Response> } = {}) {
  useAuthStore.getState().login(customer, 'customer-a');
  const reads: number[] = [], writes: string[] = [];
  api.defaults.adapter = (async config => {
    const id = Number(config.url?.match(/orders\/(\d+)/)?.[1]);
    let data: Response;
    if (config.method === 'get') { reads.push(id); data = await (options.read?.(id, reads.length) ?? Promise.resolve({ after_sales: row() })); }
    else { writes.push(config.url!); data = await (options.write?.(config) ?? Promise.resolve({ after_sales: row('withdrawn') })); }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  }) as AxiosAdapter;
  const view = render(<OrderAfterSales orderId={1} />); await settle();
  return { view, reads, writes };
}
afterEach(() => { api.defaults.adapter = originalAdapter; });
const t = (key: string) => translate(key);
const refresh = () => screen.getByRole('button', { name: t('刷新售后进度') });
const fillParcel = () => {
  fireEvent.change(screen.getByLabelText(t('退货快递公司')), { target: { value: ' Draft carrier ' } });
  fireEvent.change(screen.getByLabelText(t('退货运单号')), { target: { value: ' Draft tracking ' } });
};

describe('customer after-sales refresh', () => {
  it.each(['zh-CN', 'en'] as const)('refreshes a loaded request after approval in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { reads } = await setup({ read: async (_id, count) => ({ after_sales: row(count === 1 ? 'requested' : 'approved') }) });
    fireEvent.click(refresh()); await settle();
    expect(reads).toEqual([1, 1]);
    expect(screen.getByLabelText(t('退货运单号'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('撤回申请') })).not.toBeInTheDocument();
  });

  it.each(['focus', 'visibilitychange', 'manual'] as const)('preserves a parcel draft during %s refresh', async event => {
    const pending = deferred<Response>();
    const { reads } = await setup({ read: async (_id, count) => count === 1 ? { after_sales: row('approved') } : pending.promise });
    fillParcel();
    if (event === 'manual') fireEvent.click(refresh());
    else if (event === 'focus') fireEvent(window, new Event('focus'));
    else fireEvent(document, new Event('visibilitychange'));
    await settle();
    expect(reads).toEqual([1, 1]);
    expect(screen.getByLabelText(t('退货运单号'))).toHaveValue(' Draft tracking ');
    await act(async () => pending.resolve({ after_sales: row('approved') })); await settle();
    expect(screen.getByLabelText(t('退货快递公司'))).toHaveValue(' Draft carrier ');
    expect(screen.getByLabelText(t('退货运单号'))).toHaveValue(' Draft tracking ');
  });

  it('preserves an application draft and its validation notice on refresh', async () => {
    await setup({ read: async () => ({ after_sales: null }) });
    fireEvent.change(screen.getByLabelText(t('申请原因')), { target: { value: ' ' } });
    fireEvent.submit(document.querySelector('form')!); await settle();
    fireEvent.click(refresh()); await settle();
    expect(screen.getByLabelText(t('申请原因'))).toHaveValue(' ');
    expect(screen.getByRole('alert')).toHaveTextContent(t('请填写1至500个字符的申请原因'));
  });

  it.each([400, 409])('reconciles only a real %s conflict while retaining the server notice', async status => {
    const { reads, writes } = await setup({ read: async (_id, count) => ({ after_sales: row(count === 1 ? 'requested' : 'approved') }),
      write: async config => { throw httpError(config, status, '仅待审核的售后申请可以撤回'); } });
    fireEvent.click(screen.getByRole('button', { name: t('撤回申请') })); await settle();
    expect(writes).toHaveLength(1);
    expect(reads).toHaveLength(status === 409 ? 2 : 1);
    expect(screen.getByRole('alert')).toHaveTextContent(t('仅待审核的售后申请可以撤回'));
    expect(screen.queryByLabelText(t('退货运单号')) !== null).toBe(status === 409);
  });

  it('keeps a tracking draft when a 409 reconciliation still allows submission', async () => {
    const { reads } = await setup({ read: async () => ({ after_sales: row('approved') }),
      write: async config => { throw httpError(config, 409, '售后申请状态已改变'); } });
    fillParcel(); fireEvent.submit(document.querySelector('form')!); await settle();
    expect(reads).toEqual([1, 1]);
    expect(screen.getByLabelText(t('退货运单号'))).toHaveValue(' Draft tracking ');
    expect(screen.getByRole('alert')).toHaveTextContent(t('售后申请状态已改变'));
  });

  it('serializes refreshes and prevents a saved stale mutation handler during a read', async () => {
    const pending = deferred<Response>();
    const { reads, writes } = await setup({ read: async (_id, count) => count === 1 ? { after_sales: row('approved') } : pending.promise });
    fillParcel(); const stale = captureHandler(document.querySelector('form')!, 'onSubmit');
    fireEvent.click(refresh()); fireEvent(window, new Event('focus')); fireEvent(document, new Event('visibilitychange')); await stale(); await settle();
    expect(reads).toEqual([1, 1]); expect(writes).toEqual([]);
    await act(async () => pending.resolve({ after_sales: row('approved', { completed_at: '2026-10-08' }) })); await settle();
    await stale(); expect(writes).toEqual([]);
  });

  it('does not refresh while a tracking mutation is pending or clear its success notice later', async () => {
    const pending = deferred<Response>();
    const { reads, writes } = await setup({ read: async () => ({ after_sales: row('approved') }), write: () => pending.promise });
    fillParcel(); const form = document.querySelector('form')!; submitTogether(form, form);
    fireEvent(window, new Event('focus')); await settle(); expect(reads).toEqual([1]); expect(writes).toHaveLength(1);
    await act(async () => pending.resolve({ after_sales: row('approved', { return_submitted_at: '2026-10-08' }) })); await settle();
    fireEvent.click(refresh()); await settle(); expect(screen.getByText(t('退货运单已保存'))).toBeInTheDocument();
  });

  it.each(['account', 'storage', 'order', 'unmount'] as const)('ignores a delayed refresh after %s changes', async change => {
    const pending = deferred<Response>();
    const { view, reads } = await setup({ read: async (_id, count) => count === 2 ? pending.promise : { after_sales: row('approved', { reason: count === 1 ? 'Initial' : 'Current' }) } });
    const staleRefresh = captureHandler(refresh()); fireEvent.click(refresh()); await settle();
    if (change === 'account') act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'customer-b'));
    if (change === 'storage') localStorage.setItem('session', 'customer-b');
    if (change === 'order') view.rerender(<OrderAfterSales orderId={2} />);
    if (change === 'unmount') view.unmount();
    await settle(); const count = reads.length;
    await staleRefresh();
    if (change === 'storage' || change === 'unmount') fireEvent(window, new Event('focus'));
    await settle();
    await act(async () => pending.resolve({ after_sales: row('requested', { reason: 'Stale' }) })); await settle();
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument(); expect(reads).toHaveLength(count);
  });
});
