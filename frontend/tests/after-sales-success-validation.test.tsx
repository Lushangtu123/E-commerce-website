import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, expect, it } from 'vitest';
import OrderAfterSales from '@/components/OrderAfterSales';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { captureHandler, render, settle } from './helpers';

const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });
const row = { request_id: 7, order_id: 1, type: 'refund', reason: 'Fixture', status: 'requested', created_at: '2026-10-10' };
const t = (key: string) => translate(key);

async function setup(kind: 'create' | 'withdraw' | 'tracking', reply: unknown, failRead = false) {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  let reads = 0, writes = 0, unavailable = failRead;
  const initial = kind === 'create' ? null : kind === 'withdraw' ? row : { ...row, type: 'return', status: 'approved' };
  const canonical = kind === 'create' ? row : kind === 'withdraw' ? { ...row, status: 'withdrawn' } : {
    ...initial, return_company: 'Carrier', return_tracking_number: 'TRACK', return_submitted_at: '2026-10-10',
  };
  api.defaults.adapter = (async config => {
    if (config.method === 'get') {
      reads++;
      if (reads > 1 && unavailable) throw new AxiosError('Unavailable', AxiosError.ERR_NETWORK, config);
      return { config, data: { after_sales: reads === 1 ? initial : canonical }, status: 200, statusText: 'OK', headers: {} };
    }
    writes++;
    return { config, data: reply, status: 200, statusText: 'OK', headers: {} };
  }) as AxiosAdapter;
  render(<OrderAfterSales orderId={1} />); await settle();
  if (kind === 'create') fireEvent.change(screen.getByLabelText(t('申请原因')), { target: { value: ' Fixture ' } });
  if (kind === 'tracking') {
    fireEvent.change(screen.getByLabelText(t('退货快递公司')), { target: { value: ' Carrier ' } });
    fireEvent.change(screen.getByLabelText(t('退货运单号')), { target: { value: ' TRACK ' } });
  }
  const name = kind === 'create' ? '提交申请' : kind === 'withdraw' ? '撤回申请' : '提交退货运单';
  const stale = captureHandler(kind === 'withdraw' ? screen.getByRole('button', { name: t(name) }) : document.querySelector('form')!, kind === 'withdraw' ? 'onClick' : 'onSubmit');
  const submit = () => kind === 'withdraw' ? fireEvent.click(screen.getByRole('button', { name: t(name) })) : fireEvent.submit(document.querySelector('form')!);
  return { submit, stale, counts: () => ({ reads, writes }), name, restoreRead: () => { unavailable = false; } };
}

it.each(['create', 'withdraw', 'tracking'] as const)('reconciles an incomplete successful %s reply without reporting a save or repeating the write', async kind => {
  const state = await setup(kind, {}, true); state.submit(); await settle();
  expect(state.counts()).toEqual({ reads: 2, writes: 1 });
  expect(screen.getByRole('button', { name: t(state.name) })).toBeDisabled();
  expect(screen.queryByText(t(kind === 'create' ? '售后申请已提交，等待审核' : kind === 'withdraw' ? '售后申请已撤回' : '退货运单已保存'))).toBeNull();
  if (kind === 'create') expect(screen.getByLabelText(t('申请原因'))).toHaveValue(' Fixture ');
  if (kind === 'tracking') expect(screen.getByLabelText(t('退货运单号'))).toHaveValue(' TRACK ');
  await state.stale(); expect(state.counts().writes).toBe(1);
  state.restoreRead(); fireEvent.click(screen.getByRole('button', { name: t('刷新售后进度') })); await settle();
  expect(state.counts()).toEqual({ reads: 3, writes: 1 });
  expect(screen.queryByRole('button', { name: t(state.name) })).toBeNull();
});

it.each([
  { kind: 'create' as const, reply: { after_sales: { ...row, order_id: 2 } } },
  { kind: 'create' as const, reply: { after_sales: { ...row, reason: 'Different intent' } } },
  { kind: 'create' as const, reply: { after_sales: { ...row, type: 'return' } } },
  ...(['approved', 'rejected', 'withdrawn'] as const).map(status => ({ kind: 'create' as const, reply: { after_sales: { ...row, status } } })),
  { kind: 'withdraw' as const, reply: { after_sales: { ...row, status: 'withdrawn', request_id: 8 } } },
  { kind: 'withdraw' as const, reply: { after_sales: row } },
  { kind: 'tracking' as const, reply: { after_sales: { ...row, type: 'return', status: 'approved' } } },
  { kind: 'tracking' as const, reply: { after_sales: { ...row, type: 'return', status: 'approved', return_company: 'Other', return_tracking_number: 'TRACK', return_submitted_at: '2026-10-10' } } },
])('rejects a successful $kind reply that does not describe this operation', async ({ kind, reply }) => {
  const state = await setup(kind, reply); state.submit(); await settle();
  expect(state.counts()).toEqual({ reads: 2, writes: 1 });
  expect(screen.queryByRole('button', { name: t(state.name) })).toBeNull();
  expect(document.body.textContent).not.toContain('Different intent');
});

it.each([{}, { after_sales: { ...row, order_id: 2 } }, { after_sales: { ...row, status: 'unknown' } }])('rejects an invalid initial after-sales read instead of allowing a new write', async response => {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  api.defaults.adapter = async config => ({ config, data: response, status: 200, statusText: 'OK', headers: {} });
  render(<OrderAfterSales orderId={1} />); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent(t('加载售后申请失败，请重试'));
  expect(screen.queryByRole('button', { name: t('提交申请') })).toBeNull();
});

it('keeps an unconfirmed operation blocked and translates its notice after changing language', async () => {
  const state = await setup('create', {}, true); state.submit(); await settle();
  act(() => useLocaleStore.getState().setLocale('en')); await settle();
  expect(screen.getByText('The result is unconfirmed. Reload after-sales progress before making more changes.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
});

it('retains the last valid progress but blocks its stale actions after an invalid refresh', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  let reads = 0, writes = 0;
  api.defaults.adapter = async config => {
    if (config.method !== 'get') writes++;
    return { config, data: ++reads === 2 ? {} : { after_sales: row }, status: 200, statusText: 'OK', headers: {} };
  };
  render(<OrderAfterSales orderId={1} />); await settle();
  const stale = captureHandler(screen.getByRole('button', { name: '撤回申请' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle();
  expect(screen.getByText('审核状态：待审核')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeDisabled();
  await stale(); expect(writes).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeEnabled();
});

it('clears a failed read confirmation notice once valid progress is reloaded', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  let reads = 0;
  api.defaults.adapter = async config => {
    reads++;
    if (reads === 3) throw new AxiosError('Unavailable', AxiosError.ERR_NETWORK, config);
    return { config, data: reads === 2 ? {} : { after_sales: row }, status: 200, statusText: 'OK', headers: {} };
  };
  render(<OrderAfterSales orderId={1} />); await settle();
  for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle(); }
  expect(screen.getByText(t('操作结果尚未确认，请刷新售后进度后再操作'))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeEnabled();
  expect(screen.queryByText(t('操作结果尚未确认，请刷新售后进度后再操作'))).toBeNull();
});
