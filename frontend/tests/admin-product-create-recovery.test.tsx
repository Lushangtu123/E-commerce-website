import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import api from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/products' }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: notices }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const networkFailure = () => new AxiosError('Lost response', 'ERR_NETWORK');
type Body = Record<string, unknown>;
async function prepare(save: (body: Body, attempt: number) => Promise<unknown> = async (_body, attempt) => {
  if (attempt === 1) throw networkFailure(); return { product_id: 99, replayed: true };
}) {
  localStorage.setItem('admin_session', 'admin-one'); localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  const writes: Body[] = [];
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get') data = config.url === '/products/categories' ? [{ category_id: 1, name: 'Category' }] : { products: [], pagination: { total: 0 } };
    else { const body = JSON.parse(config.data); writes.push(body); data = await save(body, writes.length); }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<AdminProductsPage />); await settle(); return { view, writes };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '添加商品' })); await settle();
  for (const [field, value] of Object.entries({ title: '原始商品', price: '2', 'category-id': '1', stock: '5' })) fireEvent.change(document.getElementById(`newProduct-${field}`)!, { target: { value } });
  await settle();
}
const submit = () => screen.getAllByRole('button', { name: '添加商品' }).at(-1)!;
const recover = () => screen.getByRole('button', { name: '重试确认商品' });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

describe('admin product creation recovery', () => {
  it('persists the original UUID and payload before sending, and reuses both for an explicit retry', async () => {
    let storedAtSend: string | null = null;
    const fixture = await prepare(async (_body, attempt) => {
      storedAtSend = sessionStorage.getItem('pending-product-create:admin-one');
      if (attempt === 1) throw networkFailure(); return { product_id: 99, replayed: true };
    });
    await open(); fireEvent.click(submit()); await settle();
    expect(fixture.writes[0].create_key).toMatch(uuid);
    expect(JSON.parse(storedAtSend!).input.title).toBe('原始商品');
    expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
    expect(recover()).toBeEnabled();
    fireEvent.click(recover()); await settle();
    expect(fixture.writes).toHaveLength(2); expect(fixture.writes[1]).toEqual(fixture.writes[0]);
    expect(sessionStorage.getItem('pending-product-create:admin-one')).toBeNull();
    expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
  });
  it('restores the pending creation after a page remount without automatically posting', async () => {
    const fixture = await prepare(); await open(); fireEvent.click(submit()); await settle();
    const original = fixture.writes[0]; fixture.view.unmount(); render(<AdminProductsPage />); await settle();
    expect(fixture.writes).toHaveLength(1); fireEvent.click(recover()); await settle();
    expect(fixture.writes[1]).toEqual(original);
  });
  it.each([408, 429, 500, 409])('keeps the original pending identity after status %s', async status => {
    const fixture = await prepare(async () => { throw Object.assign(new Error('Uncertain'), { response: { status, data: {} } }); });
    await open(); fireEvent.click(submit()); await settle(); fireEvent.click(recover()); await settle();
    expect(fixture.writes[1]).toEqual(fixture.writes[0]); expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
  });
  it.each([{}, { product_id: 0 }, { product_id: '99' }])('retains identity after an invalid success body %j', async response => {
    const fixture = await prepare(async () => response); await open(); fireEvent.click(submit()); await settle();
    expect(recover()).toBeEnabled(); expect(fixture.writes).toHaveLength(1);
    expect(sessionStorage.getItem('pending-product-create:admin-one')).not.toBeNull();
  });
  it('blocks a new creation if its recovery identity cannot be stored', async () => {
    const fixture = await prepare(); await open(); const denied = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    fireEvent.click(submit()); await settle(); expect(fixture.writes).toHaveLength(0);
    expect(denied).toHaveBeenCalled();
    expect(notices.error).toHaveBeenCalledWith('无法保存商品新增请求，请允许浏览器存储后重试');
  });
  it('does not reuse a pending request or stale submit after switching administrators', async () => {
    const fixture = await prepare(); await open(); const stale = captureHandler(submit()); fireEvent.click(submit()); await settle();
    localStorage.setItem('admin_session', 'admin-two'); localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Other' }));
    act(() => fixture.view.rerender(<AdminProductsPage />)); await settle(); await stale(); await settle();
    expect(screen.queryByRole('button', { name: '重试确认商品' })).not.toBeInTheDocument(); expect(fixture.writes).toHaveLength(1);
  });
  it('a deterministic validation failure clears its identity and permits correcting the draft', async () => {
    const fixture = await prepare(async () => { throw Object.assign(new Error('Invalid'), { response: { status: 400, data: { error: '商品字段或值无效，标题、价格和分类必填' } } }); });
    await open(); fireEvent.click(submit()); await settle();
    expect(sessionStorage.getItem('pending-product-create:admin-one')).toBeNull();
    expect(document.getElementById('newProduct-title')).toHaveValue('原始商品'); expect(submit()).toBeEnabled();
    expect(fixture.writes).toHaveLength(1);
  });
  it('a validation rejection on a later retry cannot resolve an earlier lost reply', async () => {
    const fixture = await prepare(async (_body, attempt) => {
      if (attempt === 1) throw networkFailure();
      throw Object.assign(new Error('Invalid'), { response: { status: 400, data: {} } });
    });
    await open(); fireEvent.click(submit()); await settle(); fireEvent.click(recover()); await settle();
    expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
    expect(sessionStorage.getItem('pending-product-create:admin-one')).not.toBeNull();
    expect(fixture.writes[1]).toEqual(fixture.writes[0]);
  });
  it('ignores an old confirmation after administrator replacement', async () => {
    const response = deferred<unknown>(); const fixture = await prepare(() => response.promise); await open(); fireEvent.click(submit()); await settle();
    localStorage.setItem('admin_session', 'admin-two'); act(() => fixture.view.rerender(<AdminProductsPage />)); await settle();
    response.resolve({ product_id: 99 }); await settle();
    expect(notices.success).not.toHaveBeenCalled(); expect(sessionStorage.getItem('pending-product-create:admin-one')).not.toBeNull();
  });
  it('shows an English pending-creation action', async () => {
    await prepare(); await open(); fireEvent.click(submit()); await settle(); useLocaleStore.getState().setLocale('en'); await settle();
    expect(screen.getByRole('button', { name: 'Retry to confirm product' })).toBeEnabled();
  });
  it('blocks malformed pending storage until it can be reread safely', async () => {
    sessionStorage.setItem('pending-product-create:admin-one', '{broken');
    const fixture = await prepare();
    expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取商品新增记录');
    expect(fixture.writes).toHaveLength(0);
    sessionStorage.removeItem('pending-product-create:admin-one');
    fireEvent.click(screen.getByRole('button', { name: '重新读取新增记录' })); await settle();
    expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
  });
  it('retains a confirmed identity if browser storage refuses to clear it', async () => {
    const fixture = await prepare(async () => ({ product_id: 99 })); await open();
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    fireEvent.click(submit()); await settle();
    expect(recover()).toBeEnabled(); expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
    fireEvent.click(recover()); await settle(); expect(fixture.writes[1]).toEqual(fixture.writes[0]);
  });
  it('blocks concurrent confirmation clicks before disabled controls render', async () => {
    const response = deferred<unknown>(); const fixture = await prepare(async (_body, attempt) => attempt === 1 ? Promise.reject(networkFailure()) : response.promise);
    await open(); fireEvent.click(submit()); await settle(); const staleRetry = captureHandler(recover());
    void staleRetry(); void staleRetry(); await settle(); expect(fixture.writes).toHaveLength(2);
    response.resolve({ product_id: 99 }); await settle();
  });
});
