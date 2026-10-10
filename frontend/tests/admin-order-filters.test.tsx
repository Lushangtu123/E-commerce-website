import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';
import api from '@/lib/api';
import { installCatalogRouter, useCatalogSearchParams } from './catalog-router';
import { captureHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>(), ready: true }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => { const params = useCatalogSearchParams(query); return query.ready ? params : null; } }));
const notices = vi.hoisted(() => [] as string[]);
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
async function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); await settle(); }

beforeEach(() => {
  reads = []; writes = []; notices.length = 0;
  query.current = new URLSearchParams(); query.listeners.clear(); query.ready = true;
  installCatalogRouter(router, query); window.history.replaceState(null, '', '/admin/orders');
});
afterEach(() => { api.defaults.adapter = originalAdapter; });
describe('admin order URL filters', () => {
  it('restores user, dates, status and page from a deep link', async () => {
    act(() => router.replace('/admin/orders?status=2&userId=7&startDate=2026-10-01&endDate=2026-10-10&page=2'));
    await setup({ list: async () => listResult(2, 41) });
    expect(reads[0].params).toEqual({ page: 2, limit: 20, status: '2', userId: '7', startDate: '2026-10-01', endDate: '2026-10-10' });
    expect(screen.getByLabelText('用户编号')).toHaveValue('7');
    expect(screen.getByText('第 2 页')).toBeInTheDocument(); expect(writes).toEqual([]);
  });
  it('applies trimmed user and dates once, preserving unrelated parameters and resetting page', async () => {
    act(() => router.replace('/admin/orders?ref=a&page=2'));
    await setup({ list: async () => listResult(1, 41) });
    fireEvent.change(screen.getByLabelText('用户编号'), { target: { value: ' 7 ' } });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
    expect(reads).toHaveLength(1); await click('搜索');
    expect(reads.at(-1)?.params).toEqual({ page: 1, limit: 20, userId: '7', startDate: '2026-10-01' });
    expect(new URLSearchParams(window.location.search).get('ref')).toBe('a');
    await click('下一页'); expect(reads.at(-1)?.params?.page).toBe(2);
    const deepLink = window.location.pathname + window.location.search;
    await click('重置'); expect(window.location.search).toBe('?ref=a');
    act(() => router.replace(deepLink)); await settle();
    expect(screen.getByLabelText('用户编号')).toHaveValue('7'); expect(screen.getByText('第 2 页')).toBeInTheDocument();
  });
  it.each(['userId=01','userId=9007199254740992','status=5','startDate=2026-02-30','startDate=2026-10-10&endDate=2026-10-01','page=10001','userId=1&userId=2','page=2&page=3',`orderNo=${'x'.repeat(33)}`])('blocks invalid URL filters without broadening the read (%s)', async params => {
    act(() => router.replace(`/admin/orders?${params}`)); await setup();
    expect(reads).toEqual([]); expect(screen.getByRole('alert')).toHaveTextContent('订单筛选条件无效');
    await click('重置'); expect(reads).toHaveLength(1);
  });
  it('does not erase the deep link while Next search parameters are unavailable', async () => {
    act(() => router.replace('/admin/orders?userId=7&page=2')); query.ready = false;
    const view = await setup({ list: async () => listResult(1, 41) });
    expect(reads).toEqual([]); expect(window.location.search).toBe('?userId=7&page=2');
    query.ready = true; view.rerender(<AdminOrdersPage />); await settle();
    expect(reads[0].params).toEqual({ page: 2, limit: 20, userId: '7' });
  });
  it('clears filter ownership on an administrator change', async () => {
    act(() => router.replace('/admin/orders?userId=7&page=2'));
    await setup({ list: async () => listResult(1, 41) });
    act(() => { signIn('admin-b'); window.dispatchEvent(new StorageEvent('storage', { key: 'admin_user' })); }); await settle();
    expect(window.location.search).toBe(''); expect(screen.getByLabelText('用户编号')).toHaveValue('');
    expect(reads.at(-1)?.params).toEqual({ page: 1, limit: 20 });
  });
  it('preserves unsent drafts and retires old handlers throughout a deferred Next navigation', async () => {
    await setup({ list: async () => listResult(1, 41) });
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: ' raw draft ' } });
    fireEvent.change(screen.getByLabelText('用户编号'), { target: { value: ' 7 ' } });
    const staleSearch = captureHandler(screen.getByRole('search'), 'onSubmit');
    const staleNext = captureHandler(screen.getByRole('button', { name: '下一页' }));
    const commit = router.push.getMockImplementation()!;
    router.push.mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText('订单状态'), { target: { value: '1' } }); await settle();
    expect(screen.getByLabelText('订单号')).toHaveValue(' raw draft ');
    const calls = router.push.mock.calls.length;
    await staleSearch(); await staleNext(); await settle();
    expect(router.push.mock.calls).toHaveLength(calls); expect(reads).toHaveLength(1);
    act(() => commit(router.push.mock.calls[0][0], { scroll: false })); await settle();
    expect(screen.getByLabelText('订单号')).toHaveValue(' raw draft ');
    expect(screen.getByLabelText('用户编号')).toHaveValue(' 7 ');
    expect(reads.at(-1)?.params).toEqual({ page: 1, limit: 20, status: '1' });
  });

});
