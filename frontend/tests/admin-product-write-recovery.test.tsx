import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '@/app/admin/products/page';
import api from '@/lib/api';
import { apiError, captureHandler, deferred, render, settle } from './helpers';
const notices = vi.hoisted(() => [] as string[]);
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: (message: string) => notices.push(message), error: (message: string) => notices.push(message) } }));
type Call = { path?: string; params?: { page?: number; status?: string }; body?: Record<string, unknown> };
const originalAdapter = api.defaults.adapter;
const product = (stock = 2) => ({ product_id: 1, title: '库存商品', price: '12.50', stock, category_id: 1, status: 1, main_image: null, specs: null, specs_en: null });
const result = (stock = 2) => ({ products: [product(stock)], pagination: { total: 1, totalPages: 1 } });
const failure = (status?: number) => status === undefined ? Object.assign(new Error('Response lost'), { code: 'ERR_NETWORK' }) : Object.assign(new Error('Response lost'), { response: { status, data: { error: 'Server response' } } });
let reads: Call[], writes: Call[], readSessions: (string | null)[];
function signIn(id: string) { localStorage.setItem('admin_session', id); localStorage.setItem('admin_user', JSON.stringify({ admin_id: id === 'a' ? 1 : 2, username: id })); }
async function setup({ list = async () => result(), mutate = async () => { throw failure(); } }: { list?: (call: Call) => Promise<unknown>; mutate?: (call: Call) => Promise<unknown> } = {}) {
  signIn('a');
  const adapter: AxiosAdapter = async config => {
    const call: Call = { path: config.url, params: config.params, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data };
    const data = config.url === '/products/categories' ? [{ category_id: 1, name: '分类' }] : config.method === 'get' ? (reads.push(call), readSessions.push(localStorage.getItem('admin_session')), await list(call)) : (writes.push(call), await mutate(call));
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<ProductsPage />); await settle(); return view;
}
async function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); await settle(); }
async function draftStock() { await click('编辑'); fireEvent.change(screen.getByLabelText('库存'), { target: { value: '5' } }); await settle(); }
async function save() { await draftStock(); await click('保存修改'); }
describe('administrator product write recovery', () => {
  beforeEach(() => { reads = []; writes = []; readSessions = []; notices.length = 0; });
  afterEach(() => { api.defaults.adapter = originalAdapter; });
  it.each([undefined, 408, 409, 429, 500, 503])('retires stock intent after uncertain HTTP %s even when a buyer changes committed stock', async status => {
    let stock = 2;
    await setup({ list: async () => result(stock), mutate: async call => { stock = Number(call.body?.stock) - 1; throw failure(status); } });
    await draftStock(); const stale = captureHandler(screen.getByRole('button', { name: '保存修改' })); await click('保存修改');
    expect(stock).toBe(4); expect(reads).toHaveLength(2); expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
    await stale(); await settle(); expect(writes).toHaveLength(1); expect(stock).toBe(4);
    await click('编辑'); expect(screen.getByLabelText('库存')).toHaveValue('4'); await click('保存修改'); expect(writes).toHaveLength(1);
    expect(notices).not.toContain('商品更新成功'); expect(notices).toContain('已重新加载当前商品数据，请核对后重新编辑；此前提交结果仍无法确认');
  });
  it('retires the draft when a read shows no applied write instead of offering its replay', async () => {
    await setup(); await save(); expect(reads).toHaveLength(2); expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
    await click('编辑'); expect(screen.getByLabelText('库存')).toHaveValue('2'); await click('保存修改'); expect(writes).toHaveLength(1);
  });
  it.each([null, {}, { message: 1 }, { status: 1 }])('reconciles malformed write acknowledgement %j without claiming success', async response => {
    await setup({ mutate: async () => response }); await save(); expect(reads).toHaveLength(2); expect(writes).toHaveLength(1);
    expect(notices).not.toContain('商品更新成功'); expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
  });
  it.each([null, {}, { products: null, pagination: { total: 1 } }, { products: [product(-1)], pagination: { total: 1 } }, { products: [{ ...product(), stock: '4' }], pagination: { total: 1 } }])('keeps inventory locked for malformed read %j and retries GET only', async malformed => {
    let count = 0; await setup({ list: async () => ++count === 2 ? malformed : result(4) }); await save();
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled(); expect(screen.getByRole('button', { name: '重新核对商品' })).toBeEnabled();
    await click('重新核对商品'); expect(writes).toHaveLength(1); expect(count).toBe(3); await click('编辑'); expect(screen.getByLabelText('库存')).toHaveValue('4');
  });
  it('keeps the lock across filters after read failure and reloads the current filter on retry', async () => {
    let checks = 0;
    await setup({ list: async call => { if (++checks === 2) throw failure(503); return call.params?.status === '0' ? { products: [], pagination: { total: 0, totalPages: 0 } } : result(); } }); await save();
    const stale = captureHandler(screen.getByRole('button', { name: '重新核对商品' })); fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } }); await settle();
    expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled(); await stale(); await settle();
    expect(writes).toHaveLength(1); expect(reads.at(-1)?.params?.status).toBe('0'); expect(screen.queryByRole('button', { name: '重新核对商品' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
  });
  it.each([400, 401, 403, 404, 422])('keeps rejected HTTP %s editable without reconciliation', async status => {
    await setup({ mutate: async () => { throw Object.assign(apiError('Rejected'), { response: { status, data: { error: 'Rejected' } } }); } }); await save();
    expect(reads).toHaveLength(1); expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled(); expect(screen.getByLabelText('库存')).toHaveValue('5'); expect(notices).toEqual(['Rejected']);
  });
  it('keeps normal successful edits and refreshes', async () => {
    await setup({ mutate: async () => ({ message: '更新成功' }), list: async () => result(writes.length ? 5 : 2) }); await save(); expect(notices).toEqual(['商品更新成功']); expect(reads).toHaveLength(2); expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
  });
  it.each(['storage', 'account', 'unmount'] as const)('ignores recovery after a pending write loses its %s session', async change => {
    const pending = deferred(); const view = await setup({ mutate: () => pending.promise }); await draftStock(); fireEvent.click(screen.getByRole('button', { name: '保存修改' })); await settle();
    if (change === 'unmount') view.unmount(); else { signIn('b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); }
    await settle(); const before = readSessions.filter(id => id === 'a').length; await act(async () => pending.reject(failure())); await settle(); expect(readSessions.filter(id => id === 'a')).toHaveLength(before); expect(notices).toEqual([]);
  });
  it.each(['storage', 'account', 'unmount'] as const)('ignores late reconciliation after a %s change', async change => {
    const pending = deferred(); let checks = 0; const view = await setup({ list: async () => ++checks === 2 ? pending.promise : result() }); await save(); expect(checks).toBe(2);
    if (change === 'unmount') view.unmount(); else { signIn('b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); }
    await settle(); const before = readSessions.filter(id => id === 'a').length; await act(async () => pending.resolve(result(4))); await settle(); expect(readSessions.filter(id => id === 'a')).toHaveLength(before); expect(notices).toEqual([]);
  });
});
