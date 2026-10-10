import { installCatalogRouter, useCatalogSearchParams } from './catalog-router';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';
import api from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

const notices = vi.hoisted(() => [] as string[]);
const orderQuery = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => useCatalogSearchParams(orderQuery) }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: { success: (message: string) => notices.push(message), error: (message: string) => notices.push(message) } }));

type Call = { path?: string; params?: { page?: number; status?: string }; data?: Record<string, unknown>; session: string | null };
const order = (status = 1, id = 1) => ({ order_id: id, order_no: `ORDER-${id}`, status, total_amount: '10.00', shipping_company: status === 2 || status === 3 ? 'SF Express' : null,
  tracking_number: status === 2 || status === 3 ? 'SF123456' : null, created_at: '2026-10-04T00:00:00Z' });
const listResult = (status = 1, total = 1, id = 1) => ({ orders: [order(status, id)], pagination: { total } });
const detailResult = (status = 2) => ({ order: order(status), items: [] });
const failure = (status?: number) => status === undefined ? new Error('Response lost') : Object.assign(new Error('Response lost'), { response: { status, data: { error: 'Server response' } } });
let reads: Call[] = [], writes: Call[] = [];
const originalAdapter = api.defaults.adapter;

async function setup({ list = async () => listResult(), detail = async () => detailResult(), mutate = async () => { throw failure(); } }: {
  list?: (call: Call) => Promise<unknown>; detail?: (call: Call) => Promise<unknown>; mutate?: (call: Call) => Promise<unknown>;
} = {}) {
  signIn('admin-a');
  vi.stubGlobal('confirm', () => true);
  const adapter: AxiosAdapter = async config => {
    const call: Call = { path: config.url, params: config.params, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, session: localStorage.getItem('admin_session') };
    let data;
    if (config.method === 'get') { reads.push(call); data = await (config.url === '/admin/orders' ? list(call) : detail(call)); }
    else { writes.push(call); data = await mutate(call); }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<AdminOrdersPage />);
  await settle();
  return view;
}
function signIn(id: string) {
  localStorage.setItem('admin_session', id);
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: id === 'admin-a' ? 1 : 2, username: id }));
}
const shipmentForm = () => document.querySelector<HTMLFormElement>('form:not([role="search"])')!;
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
async function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); await settle(); }
async function fillShipment() {
  await click('发货');
  fireEvent.change(field('shipping_company'), { target: { value: ' SF Express ' } });
  fireEvent.change(field('tracking_number'), { target: { value: ' SF123456 ' } });
}
async function ship() { await fillShipment(); fireEvent.submit(shipmentForm()); await settle(); }

describe('administrator order write recovery', () => {
  beforeEach(() => { reads = []; writes = []; notices.length = 0; });
  afterEach(() => { api.defaults.adapter = originalAdapter; });

  it.each([undefined, 408, 409, 429, 500, 503])('confirms an applied shipment after uncertain HTTP %s without repeating the write', async status => {
    let stored = 1;
    await setup({ list: async () => listResult(stored), mutate: async () => { stored = 2; throw failure(status); } });
    await ship();
    expect(reads.filter(call => call.path === '/admin/orders/1')).toHaveLength(1);
    expect(screen.getByText('已发货', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('SF123456', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认发货' })).not.toBeInTheDocument();
    expect(writes).toHaveLength(1);
    expect(notices).toContain('已核对，订单状态已更新');
  });

  it.each([{}, null, { status: 1 }, { status: '2' }])('verifies an invalid successful response %j by reading the order', async response => {
    await setup({ mutate: async () => response, list: async () => listResult(writes.length ? 2 : 1) });
    await ship();
    expect(reads.some(call => call.path === '/admin/orders/1')).toBe(true);
    expect(screen.getByText('已发货', { selector: 'span' })).toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it('keeps an unresolved shipment locked across filters and lets the operator retry only its detail read', async () => {
    let checks = 0;
    await setup({ detail: async () => { if (++checks === 1) throw failure(503); return detailResult(); }, list: async () => listResult(writes.length && checks > 1 ? 2 : 1) });
    await fillShipment();
    const stale = captureHandler(shipmentForm(), 'onSubmit');
    submitTogether(shipmentForm(), shipmentForm()); await settle();
    expect(writes).toHaveLength(1);
    expect(screen.getByRole('button', { name: '确认发货' })).toBeDisabled();
    expect(field('shipping_company')).toHaveValue(' SF Express ');
    fireEvent.change(screen.getByRole('combobox', { name: '订单状态' }), { target: { value: '1' } }); await settle();
    expect(screen.getByRole('button', { name: '发货' })).toBeDisabled();
    await stale(); await settle();
    expect(writes).toHaveLength(1);
    await click('重新核对订单');
    expect(checks).toBe(2);
    expect(writes).toHaveLength(1);
    expect(screen.getByText('暂无订单')).toBeInTheDocument();
    await click('重置');
    expect(screen.getByText('已发货', { selector: 'span' })).toBeInTheDocument();
  });

  it.each([{ order: { ...order(2), order_id: 8 } }, { order: { ...order(2), status: 9 } }, { order: { ...order(2), tracking_number: null } }, {}])('keeps writes locked for invalid or foreign detail %j', async detail => {
    await setup({ detail: async () => detail });
    await ship();
    expect(screen.getByRole('button', { name: '确认发货' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新核对订单' })).toBeEnabled();
    fireEvent.submit(shipmentForm()); await settle();
    expect(writes).toHaveLength(1);
    expect(notices).not.toContain('已核对，订单状态已更新');
  });

  it('keeps the draft editable after the detail confirms the shipment was not applied', async () => {
    await setup({ detail: async () => detailResult(1), mutate: async () => { if (writes.length === 1) throw failure(); return { status: 2 }; }, list: async () => listResult(writes.length > 1 ? 2 : 1) });
    await ship();
    expect(screen.getByRole('button', { name: '确认发货' })).toBeEnabled();
    expect(field('shipping_company')).toHaveValue(' SF Express ');
    expect(notices).toContain('已核对，订单尚未更新，请确认信息后重试');
    fireEvent.change(field('tracking_number'), { target: { value: 'Corrected tracking' } });
    fireEvent.submit(shipmentForm()); await settle();
    expect(writes).toHaveLength(2);
    expect(writes[1].data?.tracking_number).toBe('Corrected tracking');
  });

  it('restores the submitted draft after changing filters and confirming that the shipment was not applied', async () => {
    let checks = 0;
    await setup({ detail: async () => { if (++checks === 1) throw failure(503); return detailResult(1); } });
    await ship();
    fireEvent.change(screen.getByRole('combobox', { name: '订单状态' }), { target: { value: '1' } }); await settle();
    await click('重新核对订单');
    await click('发货');
    expect(field('shipping_company')).toHaveValue(' SF Express ');
    expect(field('tracking_number')).toHaveValue(' SF123456 ');
    expect(writes).toHaveLength(1);
  });

  it('leaves a deterministic validation failure editable without reading the detail', async () => {
    await setup({ mutate: async () => { throw apiError('Invalid tracking'); } });
    await ship();
    expect(reads).toHaveLength(1);
    expect(field('tracking_number')).toHaveValue(' SF123456 ');
    expect(screen.getByRole('button', { name: '确认发货' })).toBeEnabled();
    expect(notices).toEqual(['Invalid tracking']);
  });

  it('confirms cancellation through the same recovery guard', async () => {
    await setup({ list: async () => listResult(writes.length ? 4 : 0), detail: async () => detailResult(4) });
    await click('取消订单');
    expect(reads.some(call => call.path === '/admin/orders/1')).toBe(true);
    expect(screen.getByText('已取消', { selector: 'span' })).toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it('confirms completion through the same recovery guard', async () => {
    await setup({ list: async () => listResult(writes.length ? 3 : 2), detail: async () => detailResult(3) });
    await click('完成订单');
    expect(reads.some(call => call.path === '/admin/orders/1')).toBe(true);
    expect(screen.getByText('已完成', { selector: 'span' })).toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it('can confirm completion of a legacy order whose shipping fields were never recorded', async () => {
    const legacy = { ...order(3), shipping_company: null, tracking_number: null };
    await setup({ list: async () => ({ orders: [{ ...legacy, status: writes.length ? 3 : 2 }], pagination: { total: 1 } }), detail: async () => ({ order: legacy, items: [] }) });
    await click('完成订单');
    expect(screen.getByText('已完成', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新核对订单' })).not.toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it('shows the recovery lock and GET retry in English and never submits from that retry', async () => {
    const firstCheck = deferred();
    let checks = 0;
    await setup({ detail: async () => ++checks === 1 ? firstCheck.promise : detailResult(), list: async () => listResult(checks > 1 ? 2 : 1) });
    await fillShipment();
    act(() => useLocaleStore.getState().setLocale('en'));
    fireEvent.submit(shipmentForm()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The order update result is unknown. Checking the current state...');
    expect(screen.getByRole('button', { name: 'Check order again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm shipment' })).toBeDisabled();
    await act(async () => firstCheck.reject(failure(503))); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('The order update is unconfirmed. Check the order again before submitting another update.');
    await click('Check order again');
    expect(checks).toBe(2);
    expect(writes).toHaveLength(1);
    expect(notices).toEqual(['Checked: the order status was updated.']);
  });

  it('rejects a stale recovery button before a replacement account has announced its session', async () => {
    await setup({ detail: async () => { throw failure(503); } });
    await ship();
    const stale = captureHandler(screen.getByRole('button', { name: '重新核对订单' }));
    const before = reads.length;
    signIn('admin-b');
    await stale(); await settle();
    expect(reads).toHaveLength(before);
    expect(writes).toHaveLength(1);
    expect(notices).toEqual([]);
  });

  it('checks a shipment hidden by the current filter using its detail and refreshes that current filter', async () => {
    const pending = deferred();
    let stored = 1;
    await setup({ list: async call => call.params?.status === '1' && stored === 2 ? { orders: [], pagination: { total: 0 } } : listResult(stored), mutate: async () => { await pending.promise; stored = 2; throw failure(); } });
    await fillShipment(); fireEvent.submit(shipmentForm()); await settle();
    fireEvent.change(screen.getByRole('combobox', { name: '订单状态' }), { target: { value: '1' } }); await settle();
    expect(screen.getByRole('button', { name: '发货' })).toBeDisabled();
    await act(async () => pending.resolve(undefined)); await settle();
    expect(reads.some(call => call.path === '/admin/orders/1')).toBe(true);
    expect(reads.at(-1)).toMatchObject({ path: '/admin/orders', params: { page: 1, status: '1' } });
    expect(screen.getByText('暂无订单')).toBeInTheDocument();
    expect(notices).toContain('已核对，订单状态已更新');
    expect(writes).toHaveLength(1);
  });

  it('keeps the actual checked shipment visible when a paid filter hides a different shipment', async () => {
    const refreshedList = deferred();
    const actual = { ...order(2), shipping_company: 'Other Carrier', tracking_number: 'OTHER-TRACKING' };
    await setup({ list: async () => writes.length ? refreshedList.promise : listResult(), detail: async () => ({ order: actual, items: [] }) });
    fireEvent.change(screen.getByRole('combobox', { name: '订单状态' }), { target: { value: '1' } }); await settle();
    await ship();
    const checked = screen.getByRole('region', { name: '订单核对结果' });
    expect(within(checked).getByText('ORDER-1')).toBeInTheDocument();
    expect(within(checked).getByText('已发货')).toBeInTheDocument();
    expect(within(checked).getByText('Other Carrier')).toBeInTheDocument();
    expect(within(checked).getByText('OTHER-TRACKING')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('加载中...');
    await act(async () => refreshedList.resolve({ orders: [], pagination: { total: 0 } })); await settle();
    expect(screen.getByText('暂无订单')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '订单核对结果' })).getByText('OTHER-TRACKING')).toBeInTheDocument();
    await click('搜索');
    expect(within(screen.getByRole('region', { name: '订单核对结果' })).getByText('OTHER-TRACKING')).toBeInTheDocument();
    expect(notices).toContain('订单已变更，请核对实际状态和物流信息');
    expect(writes).toHaveLength(1);
    await click('关闭');
    expect(screen.queryByRole('region', { name: '订单核对结果' })).not.toBeInTheDocument();
  });

  it.each(['account', 'storage'] as const)('hides the persistent checked shipment after a %s change', async change => {
    const actual = { ...order(2), shipping_company: 'Other Carrier', tracking_number: 'OLD-ACCOUNT-TRACKING' };
    const view = await setup({ list: async call => call.session === 'admin-b' ? listResult(1, 1, 2) : writes.length ? { orders: [], pagination: { total: 0 } } : listResult(), detail: async () => ({ order: actual, items: [] }) });
    fireEvent.change(screen.getByRole('combobox', { name: '订单状态' }), { target: { value: '1' } }); await settle();
    await ship();
    expect(screen.getByRole('region', { name: '订单核对结果' })).toHaveTextContent('OLD-ACCOUNT-TRACKING');
    signIn('admin-b');
    if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })));
    else view.rerender(<AdminOrdersPage />);
    expect(screen.queryByRole('region', { name: '订单核对结果' })).not.toBeInTheDocument();
    expect(screen.queryByText('OLD-ACCOUNT-TRACKING')).not.toBeInTheDocument();
    await settle();
  });

  it('refreshes the current page after recovery and ignores an older list response', async () => {
    const write = deferred(), oldPage = deferred();
    let pageTwoReads = 0;
    await setup({ list: async call => call.params?.page === 2 ? ++pageTwoReads === 1 ? oldPage.promise : listResult(1, 40, 2) : listResult(1, 40), mutate: () => write.promise });
    await fillShipment(); fireEvent.submit(shipmentForm()); await settle();
    await click('下一页');
    await act(async () => write.reject(failure())); await settle();
    expect(reads.at(-1)).toMatchObject({ path: '/admin/orders', params: { page: 2 } });
    expect(screen.getByText('ORDER-2')).toBeInTheDocument();
    await act(async () => oldPage.resolve(listResult(1, 40, 7))); await settle();
    expect(screen.queryByText('ORDER-7')).not.toBeInTheDocument();
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
  });

  it.each(['storage', 'account', 'unmount'] as const)('does not read or notify after a pending write loses its %s session', async change => {
    const pending = deferred();
    const view = await setup({ mutate: () => pending.promise });
    await fillShipment(); fireEvent.submit(shipmentForm()); await settle();
    if (change === 'unmount') view.unmount();
    else { signIn('admin-b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); }
    await settle(); const before = reads.length;
    await act(async () => pending.reject(failure())); await settle();
    expect(reads).toHaveLength(before);
    expect(notices).toEqual([]);
  });

  it.each(['storage', 'account', 'unmount'] as const)('ignores a late recovery read after a %s change', async change => {
    const detail = deferred();
    const view = await setup({ detail: () => detail.promise });
    await ship();
    expect(reads.some(call => call.path === '/admin/orders/1')).toBe(true);
    if (change === 'unmount') view.unmount();
    else { signIn('admin-b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); }
    await settle(); const before = reads.length;
    await act(async () => detail.resolve(detailResult())); await settle();
    expect(reads).toHaveLength(before);
    expect(notices).toEqual([]);
  });
});

beforeEach(() => { orderQuery.current = new URLSearchParams(); orderQuery.listeners.clear(); installCatalogRouter(router, orderQuery); window.history.replaceState(null, '', '/admin/orders'); });
