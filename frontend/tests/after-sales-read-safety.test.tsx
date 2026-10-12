import { Component, type ReactNode } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OrderAfterSales from '@/components/OrderAfterSales';
import AdminAfterSalesPage from '@/app/admin/after-sales/page';
import api from '@/lib/api';
import { validAfterSalesRequest } from '@/lib/after-sales-response';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle, captureHandler } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p data-testid="crash">Render crashed</p> : this.props.children; }
}
const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });
const base = { request_id: 7, order_id: 1, type: 'refund', reason: 'Fixture', status: 'approved',
  created_at: '2026-10-10T10:00:00Z', review_note: null, reviewed_at: null, return_company: null,
  return_tracking_number: null, return_submitted_at: null, completed_at: null, refund_amount: null,
  refund_reference: null, completion_note: null };
const closed = { ...base, completed_at: '2026-10-11T10:00:00Z', refund_amount: '1.25', completion_note: 'Handled', refund_reference: 'Bank reference' };
const invalidRows = [
  { ...base, user_id: { bad: true } },
  { ...base, review_note: { bad: true } },
  { ...base, type: 'return', return_submitted_at: '2026-10-10', return_company: { bad: true }, return_tracking_number: 'TRACK' },
  { ...closed, completion_note: { bad: true } },
  { ...closed, refund_reference: { bad: true } },
  { ...closed, completed_at: 'not-a-date' },
  { ...closed, completed_at: '2026-02-30' },
  { ...closed, refund_amount: undefined },
  { ...closed, refund_amount: null },
  { ...closed, refund_amount: 'NaN' },
  { ...closed, refund_amount: '1.001' },
  { ...closed, completion_note: undefined },
  { ...closed, completion_note: ' ' },
  { ...base, type: 'return', return_submitted_at: '2026-10-10', return_company: 'Carrier', return_tracking_number: null },
];
it.each(invalidRows)('rejects malformed progress before it can reach JSX or invent a refund: %j', row => {
  expect(validAfterSalesRequest(row)).toBe(false);
});
it.each([base, closed, { ...closed, refund_amount: '0.00', refund_reference: null }, {
  ...base, type: 'return', return_submitted_at: '2026-10-10', return_company: 'Carrier', return_tracking_number: 'TRACK',
}])('preserves legitimate progress, including an explicit zero refund', row => {
  expect(validAfterSalesRequest(row)).toBe(true);
});

async function setup(admin: boolean, initial: unknown) {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  let reads = 0, writes = 0;
  const good = admin ? { requests: [{ ...base, status: 'requested' }], pagination: { total: 1 } } : { after_sales: base };
  api.defaults.adapter = async config => {
    if (config.method !== 'get') writes++;
    return { config, data: ++reads === 1 ? initial : good, status: 200, statusText: 'OK', headers: {} };
  };
  render(<Boundary>{admin ? <AdminAfterSalesPage /> : <OrderAfterSales orderId={1} />}</Boundary>); await settle();
  return () => ({ reads, writes });
}
it.each([{ admin: false, field: 'review_note' }, { admin: true, field: 'review_note' }, { admin: true, field: 'user_id' }])('keeps $admin progress errors in $field recoverable with a bilingual GET-only retry', async ({ admin, field }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const row = { ...base, [field]: { bad: true } };
  const counts = await setup(admin, admin ? { requests: [row], pagination: { total: 1 } } : { after_sales: row });
  expect(screen.queryByTestId('crash')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('加载售后申请失败，请重试');
  expect(screen.queryByRole('button', { name: '通过审核' })).toBeNull();
  act(() => useLocaleStore.getState().setLocale('en')); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load after-sales requests. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await settle();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByTestId('crash')).toBeNull();
  expect(counts()).toEqual({ reads: 2, writes: 0 });
});
it.each([false, true])('rejects a contradictory successful %s envelope', async admin => {
  const counts = await setup(admin, admin ? { success: false, requests: [], pagination: { total: 0 } } : { error: 'Failure', after_sales: null });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '提交申请' })).toBeNull();
  expect(counts()).toEqual({ reads: 1, writes: 0 });
});
it('retains a valid customer snapshot and blocks captured actions after malformed progress refresh', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Fixture', email: 'fixture@example.test' }, 'fixture-session');
  let reads = 0, writes = 0;
  const row = { ...base, status: 'requested' };
  api.defaults.adapter = async config => {
    if (config.method !== 'get') writes++;
    return { config, data: { after_sales: ++reads === 2 ? { ...row, review_note: {} } : row }, status: 200, statusText: 'OK', headers: {} };
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<Boundary><OrderAfterSales orderId={1} /></Boundary>); await settle();
  const stale = captureHandler(screen.getByRole('button', { name: '撤回申请' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle();
  expect(screen.queryByTestId('crash')).toBeNull();
  expect(screen.getByText('审核状态：待审核')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeDisabled();
  await stale(); expect(writes).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '刷新售后进度' })); await settle();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeEnabled();
  expect(reads).toBe(3); expect(writes).toBe(0);
});
