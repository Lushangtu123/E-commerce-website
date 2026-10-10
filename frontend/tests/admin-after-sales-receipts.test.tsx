import { fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '@/app/admin/after-sales/page';
import api, { type AfterSalesRequest } from '@/lib/api';
import { translate } from '@/lib/i18n';
import { captureHandler, render, settle } from './helpers';

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

const saved = (kind: 'review' | 'complete') => ({ ...row(1, kind),
  ...(kind === 'review' ? { status: 'approved' as const, review_note: 'Detailed draft that must survive', reviewed_at: '2026-10-10T10:00:00Z' } :
    { refund_amount: '1.25', refund_reference: 'Bank reference', completion_note: 'Detailed draft that must survive', completed_at: '2026-10-10T10:00:00Z' }),
});
describe('admin after-sales success receipts', () => {
  it.each(['review', 'complete'] as const)('retains the %s draft when an empty acknowledgement cannot be reconciled', async kind => {
    const state = await setup(kind, { write: async () => ({}), target: async () => { throw new Error('Offline'); } });
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit');
    state.submit(); await settle();
    expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t(state.label))).toHaveValue('Detailed draft that must survive');
    expect(screen.getByRole('button', { name: t(state.button) })).toBeDisabled();
    await stale(); expect(state.counts().writes).toBe(1);
  });
  it.each(['review', 'complete'] as const)('confirms a malformed %s acknowledgement by the exact canonical request', async kind => {
    const state = await setup(kind, { write: async () => ({}), target: async () => ({ after_sales: saved(kind) }) });
    state.submit(); await settle();
    expect(state.targets).toEqual([1]);
    expect(notices.success).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(t(state.label))).toBeNull();
    expect(state.counts().writes).toBe(1);
  });
  it.each(['review', 'complete'] as const)('accepts a matching %s receipt without an additional detail read', async kind => {
    const state = await setup(kind, { write: async () => ({ after_sales: saved(kind) }) });
    state.submit(); await settle();
    expect(notices.success).toHaveBeenCalledOnce(); expect(state.targets).toEqual([]);
    expect(screen.queryByLabelText(t(state.label))).toBeNull();
  });
  it.each(['wrong request', 'wrong order', 'wrong note', 'missing time', 'wrong user'] as const)('rejects a review receipt with %s', async variant => {
    const value = { ...saved('review'), user_id: 1 };
    if (variant === 'wrong request') value.request_id = 2;
    if (variant === 'wrong order') value.order_id = 2;
    if (variant === 'wrong note') value.review_note = 'Other note';
    if (variant === 'missing time') value.reviewed_at = undefined;
    if (variant === 'wrong user') value.user_id = 2;
    const state = await setup('review', { list: () => ({ requests: [{ ...row(1, 'review'), user_id: 1 }], pagination: { total: 1 } }), write: async () => ({ after_sales: value }), target: async () => { throw new Error('Offline'); } });
    state.submit(); await settle(); expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText('审核说明')).toHaveValue('Detailed draft that must survive');
    expect(screen.getByRole('button', { name: '保存审核结果' })).toBeDisabled();
  });
  it.each(['amount', 'reference', 'note', 'time'] as const)('rejects a completion receipt with contradictory %s', async variant => {
    const value = { ...saved('complete'), ...(variant === 'amount' ? { refund_amount: '2.00' } : variant === 'reference' ? { refund_reference: 'Other' } : variant === 'note' ? { completion_note: 'Other' } : { completed_at: 'invalid' }) };
    const state = await setup('complete', { write: async () => ({ after_sales: value }), target: async () => { throw new Error('Offline'); } });
    state.submit(); await settle(); expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存结案记录' })).toBeDisabled();
  });
  it.each(['review', 'complete'] as const)('preserves a %s draft across a failed list refresh, then confirms by a read-only retry', async kind => {
    let healthy = false;
    const state = await setup(kind, { write: async () => ({}), list: count => {
      if (count > 1 && !healthy) throw new Error('Offline');
      return { requests: [row(1, kind)], pagination: { total: 1 } };
    }, target: async () => ({ after_sales: saved(kind) }) });
    state.submit(); await settle(); expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t(state.label))).toHaveValue('Detailed draft that must survive');
    healthy = true; state.reload(); await settle();
    expect(notices.success).toHaveBeenCalledOnce(); expect(state.counts().writes).toBe(1);
  });
  it('keeps a partial canonical review blocked until all terminal fields are available', async () => {
    let healthy = false;
    const state = await setup('review', { write: async () => ({}), target: async () => ({ after_sales: healthy ? saved('review') : { ...row(1, 'review'), status: 'approved' } }) });
    state.submit(); await settle();
    expect(screen.getByLabelText('审核说明')).toHaveValue('Detailed draft that must survive');
    expect(screen.getByRole('button', { name: '保存审核结果' })).toBeDisabled();
    healthy = true; state.reload(); await settle();
    expect(notices.success).toHaveBeenCalledOnce(); expect(state.counts().writes).toBe(1);
  });

});
