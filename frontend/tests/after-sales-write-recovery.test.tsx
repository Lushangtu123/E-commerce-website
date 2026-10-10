import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import OrderAfterSales from '@/components/OrderAfterSales';
import AdminAfterSales from '@/app/admin/after-sales/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { captureHandler, render, settle, deferred } from './helpers';
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: notices }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });
const row = { request_id: 7, order_id: 1, type: 'refund' as const, reason: 'Fixture', status: 'requested' as const, total_amount: '29.99', payment_method: 'external', completed_at: null };
const t = (text: string) => translate(text);
function error(config: InternalAxiosRequestConfig, status?: number) {
  return new AxiosError('Uncertain', AxiosError.ERR_NETWORK, config, undefined, status ? { config, status, statusText: 'Failure', headers: {}, data: { error: '售后申请状态已改变' } } : undefined);
}
async function setup(kind: 'create'|'withdraw'|'tracking'|'review'|'complete', options: { status?: number; failRead?: boolean; noCommit?: boolean; pending?: ReturnType<typeof deferred> } = {}) {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'customer-session');
  localStorage.setItem('admin_session', 'admin-session'); localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  const admin = ['review', 'complete'].includes(kind); let reads = 0, writes = 0, saved = false;
  const initial = kind === 'create' ? null : { ...row, ...(kind === 'tracking' ? { status: 'approved', type: 'return' } : kind === 'complete' ? { status: 'approved' } : {}) };
  const canonical = kind === 'create' ? row : { ...initial, ...(kind === 'withdraw' ? { status: 'withdrawn' } : kind === 'tracking' ? { return_submitted_at: '2026-10-08', return_tracking_number: 'FIXTURE-1', return_company: 'Carrier' } : kind === 'review' ? { status: 'approved' } : { completed_at: '2026-10-08' }) };
  api.defaults.adapter = (async config => {
    if (config.method === 'get') {
      reads++;
      if (reads === 2 && options.pending) return { config, status: 200, statusText: 'OK', headers: {}, data: await options.pending.promise };
      if (reads === 2 && options.failRead) throw error(config, 503);
      const value = !admin && useAuthStore.getState().user?.user_id !== 1 ? null : saved ? canonical : initial;
      const detail = admin && /\/admin\/after-sales\/\d+$/.test(config.url!);
      return { config, status: 200, statusText: 'OK', headers: {}, data: admin && !detail ? { requests: kind === 'review' && saved ? [] : [value], pagination: { total: kind === 'review' && saved ? 0 : 1 } } : { after_sales: value } };
    }
    writes++; saved = !options.noCommit; throw error(config, options.status);
  }) as AxiosAdapter;
  const view = render(admin ? <AdminAfterSales /> : <OrderAfterSales orderId={1} />); await settle();
  if (kind === 'create') fireEvent.change(screen.getByLabelText(t('申请原因')), { target: { value: 'Fixture' } });
  if (kind === 'tracking') {
    fireEvent.change(screen.getByLabelText(t('退货快递公司')), { target: { value: 'Carrier' } });
    fireEvent.change(screen.getByLabelText(t('退货运单号')), { target: { value: 'FIXTURE-1' } });
  }
  if (kind === 'review') {
    fireEvent.click(screen.getByRole('button', { name: t('通过审核') })); await settle();
    fireEvent.change(screen.getByLabelText(t('审核说明')), { target: { value: 'Fixture approval' } });
  }
  if (kind === 'complete') {
    fireEvent.click(screen.getByRole('button', { name: t('记录处理并结案') })); await settle();
    fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(t('结案说明')), { target: { value: 'Fixture closure' } });
  }
  const buttonName = kind === 'withdraw' ? '撤回申请' : kind === 'create' ? '提交申请' : kind === 'tracking' ? '提交退货运单' : kind === 'review' ? '保存审核结果' : '保存结案记录';
  const control = screen.getByRole('button', { name: t(buttonName) });
  const stale = captureHandler(kind === 'withdraw' ? control : document.querySelector('form')!, kind === 'withdraw' ? 'onClick' : 'onSubmit');
  const submit = () => kind === 'withdraw' ? fireEvent.click(control) : fireEvent.submit(document.querySelector('form')!);
  return { view, control, stale, submit, counts: () => ({ reads, writes }), buttonName, canonical };
}
describe('after-sales canonical reconciliation', () => {
  it.each(['create','withdraw','tracking','review','complete'] as const)('reads canonical state after lost %s response without repeating writes', async kind => {
    const state = await setup(kind); state.submit(); await settle();
    expect(state.counts()).toEqual({ reads: ['review', 'complete'].includes(kind) ? 3 : 2, writes: 1 });
    expect(screen.queryByRole('button', { name: t(state.buttonName) })).toBeNull(); await state.stale(); expect(state.counts().writes).toBe(1);
  });
  it.each([408,429,500,503,409])('reconciles admin HTTP %s and closes the obsolete review draft', async status => {
    const state = await setup('review', { status }); state.submit(); await settle();
    expect(state.counts()).toEqual({ reads: 3, writes: 1 }); expect(screen.queryByLabelText(t('审核说明'))).toBeNull();
  });
  it.each(['create','tracking','review','complete'] as const)('failed %s canonical read blocks stale write until read-only retry', async kind => {
    const state = await setup(kind, { failRead: true }); state.submit(); await settle();
    expect(state.counts()).toEqual({ reads: 2, writes: 1 }); expect(screen.getByRole('button', { name: t(state.buttonName) })).toBeDisabled();
    await state.stale(); expect(state.counts().writes).toBe(1);
    const reload = screen.getByRole('button', { name: t(kind === 'create' || kind === 'tracking' ? '刷新售后进度' : '重新加载') });
    fireEvent.click(reload); await settle(); expect(state.counts()).toEqual({ reads: ['review', 'complete'].includes(kind) ? 4 : 3, writes: 1 }); expect(screen.queryByRole('button', { name: t(state.buttonName) })).toBeNull();
  });
  it.each(['create','tracking','review','complete'] as const)('preserves %s draft after definite400 without canonical reads', async kind => {
    const state = await setup(kind, { status: 400, noCommit: true }); state.submit(); await settle(); expect(state.counts()).toEqual({ reads: 1, writes: 1 }); expect(screen.getByRole('button', { name: t(state.buttonName) })).toBeEnabled();
  });
  it('preserves an editable customer draft if a successful canonical read confirms no application', async () => {
    const state = await setup('create', { noCommit: true }); state.submit(); await settle();
    expect(state.counts()).toEqual({ reads: 2, writes: 1 }); expect(screen.getByLabelText(t('申请原因'))).toHaveValue('Fixture'); expect(screen.getByRole('button', { name: t('提交申请') })).toBeEnabled();
  });
  it('does not accept an old canonical response after the customer changes', async () => {
    const pending = deferred(); const state = await setup('create', { pending }); state.submit(); await settle();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'other-session')); await settle();
    await act(async () => pending.resolve({ after_sales: state.canonical })); await settle(); await state.stale(); expect(state.counts().writes).toBe(1); expect(screen.queryByRole('button', { name: t('撤回申请') })).toBeNull();
  });
  it('translates failed reconciliation notice when the locale changes', async () => {
    const state = await setup('create', { failRead: true }); state.submit(); await settle();
    act(() => useLocaleStore.getState().setLocale('en')); expect(screen.getByText('The result is unconfirmed. Reload after-sales progress before making more changes.')).toBeInTheDocument();
  });
  it.each([
    { kind: 'create' as const, response: {} },
    { kind: 'create' as const, response: { after_sales: { ...row, order_id: 2 } } },
    { kind: 'create' as const, response: { after_sales: { ...row, status: 'unknown' } } },
    { kind: 'review' as const, response: {} },
    { kind: 'review' as const, response: { requests: [{}], pagination: { total: 1 } } },
    { kind: 'review' as const, response: { requests: [], pagination: { total: -1 } } },
  ])('keeps $kind writes blocked when a canonical response is incomplete', async ({ kind, response }) => {
    const pending = deferred(); const state = await setup(kind, { pending }); state.submit(); await settle();
    await act(async () => pending.resolve(response)); await settle();
    expect(screen.getByRole('button', { name: t(state.buttonName) })).toBeDisabled();
    await state.stale(); expect(state.counts().writes).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: t(kind === 'create' ? '刷新售后进度' : '重新加载') })); await settle();
    expect(state.counts()).toEqual({ reads: kind === 'review' ? 4 : 3, writes: 1 }); expect(screen.queryByRole('button', { name: t(state.buttonName) })).toBeNull();
  });
});
