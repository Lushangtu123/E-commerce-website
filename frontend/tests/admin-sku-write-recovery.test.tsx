import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SKUPage from '@/app/admin/products/[id]/skus/page';
import api from '@/lib/api';
import { apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';
const params = vi.hoisted(() => ({ id: '1' }));
vi.mock('next/navigation', () => ({ useParams: () => params }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const originalAdapter = api.defaults.adapter;
const sku = (stock = 2) => ({ sku_id: 11, product_id: 1, sku_code: 'BLUE', specs: { Color: 'Blue' }, price: '12.50', stock, original_price: null, image: null, status: 1 });
const result = (stock = 2) => ({ product: { product_id: Number(params.id), title: '库存商品', status: 1 }, skus: params.id === '1' ? [sku(stock)] : [] });
const failure = (status?: number) => status === undefined ? Object.assign(new Error('Response lost'), { code: 'ERR_NETWORK' }) : Object.assign(new Error('Response lost'), { response: { status, data: { error: 'Server response' } } });
let readSessions: (string | null)[], reads: string[], writes: { path?: string; method?: string; body: Record<string, unknown> }[];
function signIn(id: string) { localStorage.setItem('admin_session', id); localStorage.setItem('admin_user', JSON.stringify({ admin_id: id === 'a' ? 1 : 2, username: id })); }
async function setup({ list = async () => result(), mutate = async () => { throw failure(); } }: { list?: () => Promise<unknown>; mutate?: (body: Record<string, unknown>) => Promise<unknown> } = {}) {
  signIn('a'); const adapter: AxiosAdapter = async config => {
    let data; if (config.method === 'get') { reads.push(config.url!); readSessions.push(localStorage.getItem('admin_session')); data = await list(); } else { const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data; writes.push({ path: config.url, method: config.method, body }); data = await mutate(body); }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  }; api.defaults.adapter = adapter; const view = render(<SKUPage />); await settle(); return view;
}
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
async function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); await settle(); }
async function draftStock() { await click('编辑规格'); fireEvent.change(field('stock'), { target: { value: '5' } }); await settle(); }
async function save() { await draftStock(); fireEvent.submit(document.querySelector('form')!); await settle(); }
describe('administrator SKU write recovery', () => {
  beforeEach(() => { reads = []; readSessions = []; writes = []; params.id = '1'; }); afterEach(() => { api.defaults.adapter = originalAdapter; });
  it.each([undefined, 408, 409, 429, 500, 503])('never replays stock after uncertain HTTP %s when a buyer changes committed quantity', async status => {
    let stock = 2; await setup({ list: async () => result(stock), mutate: async body => { stock = Number(body.stock) - 1; throw failure(status); } });
    await draftStock(); const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); submitTogether(document.querySelector('form')!, document.querySelector('form')!); await settle();
    expect(reads).toHaveLength(2); expect(writes).toHaveLength(1); expect(stock).toBe(4); expect(document.querySelector('form')).toBeNull(); await stale(); await settle(); expect(writes).toHaveLength(1); expect(stock).toBe(4);
    expect(screen.getByText('可售库存：4')).toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('已重新加载当前规格数据，请核对后重新编辑；此前提交结果仍无法确认');
    await click('编辑规格'); expect(field('stock')).toHaveValue('4'); fireEvent.submit(document.querySelector('form')!); await settle(); expect(writes).toHaveLength(1);
  });
  it('discards stock intent even when reconciliation shows no applied write', async () => {
    await setup(); await save(); expect(document.querySelector('form')).toBeNull(); expect(reads).toHaveLength(2); await click('编辑规格'); expect(field('stock')).toHaveValue('2'); fireEvent.submit(document.querySelector('form')!); await settle(); expect(writes).toHaveLength(1);
  });
  it.each([null, {}, { message: 1 }, { sku_id: 12 }])('reconciles malformed update acknowledgement %j', async response => {
    await setup({ mutate: async () => response }); await save(); expect(reads).toHaveLength(2); expect(document.querySelector('form')).toBeNull(); expect(screen.queryByText('规格已保存')).not.toBeInTheDocument();
  });
  it.each([null, {}, { product: { product_id: 2, title: 'Foreign', status: 1 }, skus: [sku()] }, { ...result(), skus: [{ ...sku(), stock: '4' }] }, { ...result(), skus: [{ ...sku(), price: null }] }])('locks on malformed read %j and retries GET only', async malformed => {
    let checks = 0; await setup({ list: async () => ++checks === 2 ? malformed : result(4) }); await save(); expect(field('stock')).toHaveValue('5'); expect(field('stock')).toBeDisabled(); expect(screen.getByRole('button', { name: '新增规格' })).toBeDisabled(); expect(screen.getByRole('button', { name: '重新核对规格' })).toBeEnabled();
    fireEvent.submit(document.querySelector('form')!); await settle(); expect(writes).toHaveLength(1); await click('重新核对规格'); expect(checks).toBe(3); expect(writes).toHaveLength(1); expect(document.querySelector('form')).toBeNull(); expect(screen.getByText('可售库存：4')).toBeInTheDocument();
  });
  it('keeps uncertain writes locked after read failure and accepts a read retry', async () => {
    let checks = 0; await setup({ list: async () => { if (++checks === 2) throw failure(503); return result(4); } }); await save(); const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); expect(screen.getByRole('alert')).toHaveTextContent('规格更新结果尚未确认，请重新加载核对；确认前不会再次提交'); await stale(); await settle(); expect(writes).toHaveLength(1); await click('重新核对规格'); expect(writes).toHaveLength(1); expect(checks).toBe(3); expect(document.querySelector('form')).toBeNull();
  });
  it.each([400, 401, 403, 404, 422])('keeps rejected HTTP %s editable without a read', async status => {
    await setup({ mutate: async () => { throw Object.assign(apiError('Rejected'), { response: { status, data: { error: 'Rejected' } } }); } }); await save(); expect(reads).toHaveLength(1); expect(field('stock')).toHaveValue('5'); expect(screen.getByRole('button', { name: '保存规格' })).toBeEnabled(); expect(screen.getByRole('alert')).toHaveTextContent('Rejected');
  });
  it('keeps normal successful updates and toggles', async () => {
    let stock = 2, status = 1; await setup({ mutate: async body => { if ('stock' in body) stock = Number(body.stock); if ('status' in body) status = Number(body.status); return { message: '更新成功' }; }, list: async () => ({ ...result(stock), skus: [{ ...sku(stock), status }] }) }); await save(); expect(screen.getByText('规格已保存')).toBeInTheDocument(); expect(screen.getByText('可售库存：5')).toBeInTheDocument(); await click('停用规格'); expect(screen.getByText('规格已停用')).toBeInTheDocument(); expect(writes).toHaveLength(2);
  });
  it('reconciles uncertain toggles without reporting a confirmed save', async () => {
    await setup(); await click('停用规格'); expect(reads).toHaveLength(2); expect(writes).toHaveLength(1); expect(screen.queryByText('规格已停用')).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('此前提交结果仍无法确认');
  });
  it('reconciles a committed create with its natural unique code without creating again', async () => {
    let created = false; await setup({ list: async () => ({ ...result(), skus: created ? [{ ...sku(4), sku_id: 12, sku_code: 'NEW' }] : [] }), mutate: async () => { created = true; throw failure(); } }); await click('新增规格'); for (const [name, value] of Object.entries({ sku_code: 'NEW', price: '12.50', stock: '5', 'spec-name-0': 'Color', 'spec-value-0': 'Blue' })) fireEvent.change(field(name), { target: { value } }); await settle();
    const stale = captureHandler(document.querySelector('form')!, 'onSubmit'); fireEvent.submit(document.querySelector('form')!); await settle(); await stale(); await settle(); expect(writes).toHaveLength(1); expect(writes[0].method).toBe('post'); expect(writes[0].body.sku_code).toBe('NEW'); expect(document.querySelector('form')).toBeNull(); expect(screen.getByText('NEW')).toBeInTheDocument();
  });
  it.each(['product', 'storage', 'account', 'unmount'] as const)('does not recover a pending write after a %s boundary', async change => {
    const pending = deferred(); const view = await setup({ mutate: () => pending.promise }); await draftStock(); fireEvent.submit(document.querySelector('form')!); await settle(); if (change === 'unmount') view.unmount(); else if (change === 'product') { params.id = '2'; view.rerender(<SKUPage />); } else { signIn('b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); } await settle(); const before = readSessions.filter(id => id === 'a').length; await act(async () => pending.reject(failure())); await settle(); expect(readSessions.filter(id => id === 'a')).toHaveLength(before); expect(screen.queryByText(/此前提交结果仍无法确认/)).not.toBeInTheDocument();
  });
  it.each(['product', 'storage', 'account', 'unmount'] as const)('ignores late recovery after a %s boundary', async change => {
    const pending = deferred(); let checks = 0; const view = await setup({ list: async () => ++checks === 2 ? pending.promise : result() }); await save(); expect(checks).toBe(2); if (change === 'unmount') view.unmount(); else if (change === 'product') { params.id = '2'; view.rerender(<SKUPage />); } else { signIn('b'); if (change === 'account') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' }))); } await settle(); const before = readSessions.filter(id => id === 'a').length; await act(async () => pending.resolve(result(4))); await settle(); expect(readSessions.filter(id => id === 'a')).toHaveLength(before); expect(screen.queryByText(/此前提交结果仍无法确认/)).not.toBeInTheDocument();
  });
});
