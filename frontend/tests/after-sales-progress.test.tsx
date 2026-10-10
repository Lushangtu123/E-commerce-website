import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderAfterSales from '@/components/OrderAfterSales';
import AdminAfterSalesPage from '@/app/admin/after-sales/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/after-sales' }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: notices }));
const originalAdapter = api.defaults.adapter;
const approved = { request_id: 7, order_id: 1, order_no: 'ORDER-1', type: 'return', reason: 'Damaged', status: 'approved',
  total_amount: '29.99', payment_method: 'external', return_submitted_at: null, completed_at: null };
async function setup(admin = false, options: { row?: object; mutate?: () => Promise<unknown> } = {}) {
  notices.error.mockClear(); notices.success.mockClear();
  useAuthStore.getState().login({ user_id: 1, username: 'Customer', email: 'customer@test' }, 'customer-a');
  localStorage.setItem('admin_session', 'admin-a'); localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  let current = { ...approved, ...options.row };
  const writes: { url?: string; body: unknown }[] = [];
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get') data = admin && !/\/admin\/after-sales\/\d+$/.test(config.url!) ? { requests: [current], pagination: { total: 1 } } : { after_sales: current };
    else {
      const body = JSON.parse(config.data); writes.push({ url: config.url, body });
      if (options.mutate) data = await options.mutate();
      else {
        current = config.url?.endsWith('/complete') ? { ...current, ...body, completion_note: body.note, refund_reference: body.refund_reference ?? null, completed_at: '2026-10-08T00:00:00Z' }
          : { ...current, return_company: body.company, return_tracking_number: body.tracking_number, return_submitted_at: '2026-10-08T00:00:00Z' };
        data = { after_sales: current };
      }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(admin ? <AdminAfterSalesPage /> : <OrderAfterSales orderId={1} />); await settle();
  return { writes, view };
}
afterEach(() => { api.defaults.adapter = originalAdapter; });
const t = (text: string) => translate(text);
const fillTracking = () => {
  fireEvent.change(screen.getByLabelText(t('退货快递公司')), { target: { value: ' Carrier ' } });
  fireEvent.change(screen.getByLabelText(t('退货运单号')), { target: { value: ' RETURN-1 ' } });
};
const openClosure = async () => { fireEvent.click(screen.getByRole('button', { name: t('记录处理并结案') })); await settle(); };
const fillClosure = () => {
  fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: '29.99' } });
  fireEvent.change(screen.getByLabelText(t('退款凭证')), { target: { value: ' ref-1 ' } });
  fireEvent.change(screen.getByLabelText(t('结案说明')), { target: { value: ' Handled ' } });
};
describe('after-sales progress', () => {
  it.each(['zh-CN', 'en'] as const)('submits a normalized parcel and shows progress in %s', async locale => {
    useLocaleStore.getState().setLocale(locale); const { writes } = await setup(); fillTracking();
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes).toEqual([{ url: '/orders/1/after-sales/return-tracking', body: { company: 'Carrier', tracking_number: 'RETURN-1' } }]);
    expect(screen.getByText(/RETURN-1/)).toBeInTheDocument();
    expect(screen.getByText(t('已寄回，待处理'))).toBeInTheDocument(); expect(document.querySelector('form')).toBeNull();
  });
  it('sends tracking once while pending and preserves its draft on failure', async () => {
    const pending = deferred(); const { writes } = await setup(false, { mutate: () => pending.promise }); fillTracking();
    const form = document.querySelector('form')!; submitTogether(form, form);
    await settle(); expect(writes).toHaveLength(1); expect(screen.getByLabelText(t('退货运单号'))).toBeDisabled();
    await act(async () => pending.reject(apiError('退货快递公司或运单号无效'))); await settle();
    expect(screen.getByLabelText(t('退货运单号'))).toHaveValue(' RETURN-1 '); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('ignores a customer tracking handler after the stored account changes', async () => {
    const { writes } = await setup(); fillTracking(); const stale = captureHandler(document.querySelector('form')!, 'onSubmit');
    localStorage.setItem('session', 'customer-b');
    await stale(); expect(writes).toEqual([]);
  });
  it.each(['zh-CN', 'en'] as const)('records manual refund and renders closure in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { writes } = await setup(true, { row: { type: 'refund' } }); await openClosure(); fillClosure();
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes).toEqual([{ url: '/admin/after-sales/7/complete', body: { refund_amount: '29.99', refund_reference: 'ref-1', note: 'Handled' } }]);
    expect(screen.getByText(t('已结案'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('记录处理并结案') })).not.toBeInTheDocument();
  });
  it('blocks a duplicate closure and ignores a stale admin handler', async () => {
    const pending = deferred(); const { writes } = await setup(true, { row: { type: 'refund' }, mutate: () => pending.promise });
    await openClosure(); fillClosure(); const form = document.querySelector('form')!; const stale = captureHandler(form, 'onSubmit');
    submitTogether(form, form); await settle(); expect(writes).toHaveLength(1);
    localStorage.setItem('admin_session', 'admin-b'); await stale();
    await act(async () => pending.resolve({})); await settle(); expect(writes).toHaveLength(1); expect(notices.success).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'reload'] as const)('invalidates the closure handler after %s in the same account and filter', async change => {
    const { writes } = await setup(true, { row: { type: 'refund' } }); await openClosure(); fillClosure();
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit');
    fireEvent.click(screen.getByRole('button', { name: t(change === 'cancel' ? '取消' : '重新加载') })); await settle();
    await stale(); expect(writes).toEqual([]);
  });
  it.each(['zh-CN', 'en'] as const)('shows customer identity and paid/refund context in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    await setup(true, { row: { type: 'refund', user_id: 1, username: 'Customer' } });
    expect(screen.getByText(`${t('用户')}：Customer`)).toBeInTheDocument();
    expect(screen.getByText(`${t('用户编号')}：1`)).toBeInTheDocument();
    expect(screen.getByText(`${t('订单实付金额')}：¥29.99`)).toBeInTheDocument();
    expect(screen.getByText(`${t('可记录退款上限')}：¥29.99`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('查看订单列表') })).toHaveAttribute('href', '/admin/orders');
    await openClosure();
    expect(screen.getAllByText(`${t('可记录退款上限')}：¥29.99`)).toHaveLength(2);
  });
  it.each(['zh-CN', 'en'] as const)('marks a demo order and explains its zero refund ceiling in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    await setup(true, { row: { type: 'refund', user_id: 8, username: null, payment_method: 'demo' } });
    expect(screen.getByText(`${t('用户')}：—`)).toBeInTheDocument();
    expect(screen.getByText(`${t('用户编号')}：8`)).toBeInTheDocument();
    expect(screen.getByText(t('演示订单，未实际扣款'))).toBeInTheDocument();
    expect(screen.getByText(`${t('可记录退款上限')}：¥0.00`)).toBeInTheDocument();
    await openClosure();
    expect(screen.getAllByText(t('演示订单，未实际扣款'))).toHaveLength(2);
  });
  it.each(['zh-CN', 'en'] as const)('rejects more than the paid amount before saving in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { writes } = await setup(true, { row: { type: 'refund' } }); await openClosure(); fillClosure();
    fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: '30.00' } });
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes).toEqual([]); expect(notices.error).toHaveBeenCalledWith(t('退款金额不能超过订单实付金额'));
    expect(screen.getByLabelText(t('实际退款金额'))).toHaveValue('30.00');
  });
  it.each(['zh-CN', 'en'] as const)('rejects a nonzero demo refund before saving in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { writes } = await setup(true, { row: { type: 'refund', payment_method: 'demo' } }); await openClosure(); fillClosure();
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes).toEqual([]); expect(notices.error).toHaveBeenCalledWith(t('演示订单未实际扣款，退款金额必须为零'));
  });
  it('accepts zero for demo closure without a reference', async () => {
    const { writes } = await setup(true, { row: { type: 'refund', payment_method: 'demo' } }); await openClosure();
    fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: '0.00' } });
    fireEvent.change(screen.getByLabelText(t('结案说明')), { target: { value: 'No payment taken' } });
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes[0].body).toEqual({ refund_amount: '0.00', note: 'No payment taken' });
  });
  it.each(['29.991', '1e1', '99999999999999'])('rejects malformed or out-of-range cents %s', async amount => {
    const { writes } = await setup(true, { row: { type: 'refund' } }); await openClosure(); fillClosure();
    fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: amount } });
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(writes).toEqual([]); expect(notices.error).toHaveBeenCalledWith(t('退款金额、凭证或结案说明无效'));
  });
});
