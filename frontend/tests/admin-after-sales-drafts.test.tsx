import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '@/app/admin/after-sales/page';
import api, { type AfterSalesRequest } from '@/lib/api';
import { ADMIN_SESSION_EVENT } from '@/lib/admin-session';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { captureHandler, deferred, reactHandler, render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: notices }));
const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });
const t = (text: string) => translate(text);
const row = (id: number, kind: 'review' | 'complete'): AfterSalesRequest => ({
  request_id: id, order_id: id, order_no: `AFTER-${id}`, type: 'refund', reason: 'Fixture',
  status: kind === 'review' ? 'requested' : 'approved', total_amount: '29.99', payment_method: 'external', completed_at: null,
});
function signIn(id = 'admin-a') {
  localStorage.setItem('admin_session', id);
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: id === 'admin-a' ? 1 : 2, username: id }));
}
function network(config: InternalAxiosRequestConfig) { return new AxiosError('Lost response', AxiosError.ERR_NETWORK, config); }
async function setup(kind: 'review' | 'complete', options: {
  target?: () => Promise<unknown>; write?: (config: InternalAxiosRequestConfig) => Promise<unknown>;
  list?: (count: number) => { requests: AfterSalesRequest[]; pagination: { total: number } };
} = {}) {
  signIn(); let lists = 0, writes = 0; const targets: number[] = [];
  api.defaults.adapter = (async config => {
    let data;
    if (config.method !== 'get') { writes++; data = await (options.write?.(config) ?? Promise.reject(network(config))); }
    else if (/\/admin\/after-sales\/\d+$/.test(config.url!)) {
      targets.push(Number(config.url!.split('/').at(-1)));
      data = await (options.target?.() ?? Promise.resolve({ after_sales: row(1, kind) }));
    } else {
      lists++;
      data = options.list?.(lists) ?? { requests: Array.from({ length: 20 }, (_, index) => row((lists === 1 ? 20 : 21) - index, kind)), pagination: { total: lists === 1 ? 20 : 21 } };
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  }) as AxiosAdapter;
  const view = render(<Page />); await settle();
  fireEvent.click(screen.getAllByRole('button', { name: t(kind === 'review' ? '通过审核' : '记录处理并结案') }).at(-1)!);
  if (kind === 'complete') {
    fireEvent.change(screen.getByLabelText(t('实际退款金额')), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText(t('退款凭证')), { target: { value: 'Bank reference' } });
  }
  const label = kind === 'review' ? '审核说明' : '结案说明', button = kind === 'review' ? '保存审核结果' : '保存结案记录';
  fireEvent.change(screen.getByLabelText(t(label)), { target: { value: 'Detailed draft that must survive' } });
  return { view, label, button, targets, counts: () => ({ lists, writes }), submit: () => fireEvent.submit(document.querySelector('form')!), reload: () => fireEvent.click(screen.getByRole('button', { name: t('重新加载') })) };
}
describe('admin after-sales drafts use the exact request identity', () => {
  it.each(['review', 'complete'] as const)('preserves a displaced %s draft and can submit it again after authoritative reconciliation', async kind => {
    const state = await setup(kind); state.submit(); await settle();
    expect(state.targets).toEqual([1]);
    expect(screen.queryByText(/AFTER-1$/)).toBeNull();
    expect(screen.getByLabelText(t(state.label))).toHaveValue('Detailed draft that must survive');
    if (kind === 'complete') {
      expect(screen.getByLabelText(t('实际退款金额'))).toHaveValue('1.25');
      expect(screen.getByLabelText(t('退款凭证'))).toHaveValue('Bank reference');
      expect(screen.getAllByText(/¥29.99/).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: t(state.button) })).toBeEnabled();
    state.submit(); await settle(); expect(state.counts().writes).toBe(2);
  });
  it.each(['review', 'complete'] as const)('retires an externally finished %s draft on a normal refresh with visible feedback', async kind => {
    const state = await setup(kind, { target: async () => ({ after_sales: { ...row(1, kind), ...(kind === 'review' ? { status: 'approved' } : { completed_at: '2026-10-09' }) } }), list: count => ({ requests: count === 1 ? [row(1, kind)] : [], pagination: { total: count === 1 ? 1 : 0 } }) });
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); state.reload(); await settle();
    expect(state.targets).toEqual([1]); expect(screen.queryByLabelText(t(state.label))).toBeNull();
    expect(notices.error).toHaveBeenCalledWith(t('售后申请状态已改变，已关闭当前草稿，请核对最新进度'));
    await stale(); expect(state.counts().writes).toBe(0);
  });
  it.each(['review', 'complete'] as const)('blocks %s while a target read is pending and ignores a stale submit', async kind => {
    const pending = deferred(); const state = await setup(kind, { target: () => pending.promise });
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); state.reload(); await settle();
    expect(screen.getByRole('button', { name: t(state.button) })).toBeDisabled(); await stale();
    expect(state.counts().writes).toBe(0);
    await act(async () => pending.resolve({ after_sales: row(1, kind) })); await settle();
    expect(screen.getByRole('button', { name: t(state.button) })).toBeEnabled();
  });
  it.each(['failure', 'missing', 'wrong-id', 'invalid-status'] as const)('retains the draft and blocks duplicate writes for a %s target read until read-only retry', async variant => {
    let reads = 0;
    const state = await setup('review', { target: async () => {
      if (++reads > 1) return { after_sales: row(1, 'review') };
      if (variant === 'failure') throw new Error('Read failed');
      return variant === 'missing' ? {} : { after_sales: { ...row(1, 'review'), ...(variant === 'wrong-id' ? { request_id: 2 } : { status: 'unknown' }) } };
    } });
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); state.submit(); await settle();
    expect(screen.getByLabelText('审核说明')).toHaveValue('Detailed draft that must survive');
    expect(screen.getByRole('button', { name: '保存审核结果' })).toBeDisabled();
    await stale(); expect(state.counts().writes).toBe(1);
    state.reload(); await settle();
    expect(state.targets).toEqual([1, 1]); expect(state.counts().writes).toBe(1);
    expect(screen.getByRole('button', { name: '保存审核结果' })).toBeEnabled();
  });
  it('also blocks a closure draft after a malformed completion target read', async () => {
    const state = await setup('complete', { target: async () => ({ after_sales: { ...row(1, 'complete'), order_id: 2 } }) });
    state.submit(); await settle(); expect(screen.getByRole('button', { name: '保存结案记录' })).toBeDisabled();
    expect(screen.getByLabelText('结案说明')).toHaveValue('Detailed draft that must survive');
  });
  it.each(['total_amount', 'payment_method', 'completed_at'] as const)('keeps closure blocked when the target omits %s', async field => {
    const incomplete = { ...row(1, 'complete') }; delete incomplete[field];
    const state = await setup('complete', { target: async () => ({ after_sales: incomplete }) });
    state.submit(); await settle();
    expect(screen.getByRole('button', { name: '保存结案记录' })).toBeDisabled();
    expect(screen.getByLabelText('退款凭证')).toHaveValue('Bank reference');
  });
  it('updates a still-listed row from the authoritative target before offering another action', async () => {
    const state = await setup('review', { target: async () => ({ after_sales: { ...row(1, 'review'), status: 'rejected' } }), list: () => ({ requests: [row(1, 'review')], pagination: { total: 1 } }) });
    const staleOpen = captureHandler(screen.getByRole('button', { name: '通过审核' }));
    state.reload(); await settle();
    expect(screen.queryByRole('button', { name: '通过审核' })).toBeNull();
    expect(screen.queryByLabelText('审核说明')).toBeNull();
    await staleOpen(); expect(screen.queryByLabelText('审核说明')).toBeNull();
  });
  it('keeps an off-page draft when the refreshed list shrinks below the current page', async () => {
    const state = await setup('review', { list: count => ({ requests: count < 3 ? [row(1, 'review')] : [], pagination: { total: count < 3 ? 40 : 0 } }) });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    fireEvent.click(screen.getByRole('button', { name: '通过审核' }));
    fireEvent.change(screen.getByLabelText('审核说明'), { target: { value: 'Second-page draft' } });
    state.reload(); await settle();
    expect(screen.getByLabelText('审核说明')).toHaveValue('Second-page draft');
    expect(screen.getByRole('button', { name: '保存审核结果' })).toBeEnabled();
    expect(screen.getByText('第 2 页')).toBeInTheDocument(); expect(state.targets).toEqual([1]);
  });
  it('ignores a delayed target response after the status filter changes', async () => {
    const pending = deferred(); const state = await setup('review', { target: () => pending.promise });
    state.reload(); await settle();
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'approved' } }); await settle();
    await act(async () => pending.resolve({ after_sales: { ...row(1, 'review'), status: 'approved' } })); await settle();
    expect(screen.queryByLabelText('审核说明')).toBeNull(); expect(notices.error).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '审核状态' })).toHaveValue('approved');
  });
  it('does not apply a delayed target read to a replacement administrator', async () => {
    const pending = deferred(); const state = await setup('review', { target: () => pending.promise });
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); state.reload(); await settle();
    act(() => { signIn('admin-b'); window.dispatchEvent(new Event(ADMIN_SESSION_EVENT)); }); await settle();
    await act(async () => pending.resolve({ after_sales: { ...row(1, 'review'), status: 'approved' } })); await settle(); await stale();
    expect(screen.queryByLabelText('审核说明')).toBeNull(); expect(notices.error).not.toHaveBeenCalled(); expect(state.counts().writes).toBe(0);
  });
  it('ignores a filter handler captured before the administrator changed', async () => {
    await setup('review');
    const stale = reactHandler(screen.getByRole('combobox', { name: '审核状态' }), 'onChange');
    act(() => { signIn('admin-b'); window.dispatchEvent(new Event(ADMIN_SESSION_EVENT)); }); await settle();
    act(() => { stale({ target: { value: 'rejected' } }); }); await settle();
    expect(screen.getByRole('combobox', { name: '审核状态' })).toHaveValue('requested');
  });
  it('translates authoritative refresh feedback in English', async () => {
    useLocaleStore.getState().setLocale('en');
    const state = await setup('review', { target: async () => ({ after_sales: { ...row(1, 'review'), status: 'withdrawn' } }) });
    state.reload(); await settle();
    expect(notices.error).toHaveBeenCalledWith('The after-sales request changed. The current draft was closed; check its latest progress.');
  });
});
