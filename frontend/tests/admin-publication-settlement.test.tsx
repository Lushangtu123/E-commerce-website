import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/admin/orders/page';
import AfterSalesPage from '@/app/admin/after-sales/page';
import ProductsPage from '@/app/admin/products/page';
import CouponsPage from '@/app/admin/coupons/page';
import api from '@/lib/api';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT, startAdminSession } from '@/lib/admin-session';
import { captureHandler, deferred, render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
const originalAdapter = api.defaults.adapter;
const first = { admin_id: 1, username: 'First administrator' };
const second = { admin_id: 2, username: 'Second administrator' };
const product = (stock: number) => ({ product_id: 1, title: '库存商品', price: '12.50', stock, category_id: 1, status: 1, main_image: null, specs: null, specs_en: null });
const products = (stock = 2) => ({ products: [product(stock)], pagination: { total: 1, totalPages: 1 } });
const orders = (status = 1) => ({ orders: [{ order_id: 1, order_no: 'PAUSED-ORDER', status, total_amount: '10.00', created_at: '2026-10-02T00:00:00Z', shipping_company: status === 2 ? 'SF Express' : null, tracking_number: status === 2 ? 'SF123456' : null }], pagination: { total: 1 } });
const afterSales = { requests: [{ request_id: 1, order_id: 1, order_no: 'PAUSED-SERVICE', type: 'refund', reason: 'Fixture', status: 'requested', created_at: '2026-10-02T00:00:00Z' }], pagination: { total: 1 } };
let releases: Array<() => void>;
function mark(pending: boolean) {
  act(() => {
    if (pending) localStorage.setItem(ADMIN_CLEANUP_KEY, '1'); else localStorage.removeItem(ADMIN_CLEANUP_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_CLEANUP_KEY, storageArea: localStorage }));
    window.dispatchEvent(new Event(ADMIN_SESSION_EVENT));
  });
}
function serve(answer: (config: InternalAxiosRequestConfig) => unknown) {
  api.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: await answer(config) });
}
beforeEach(() => { releases = []; startAdminSession(first); });
afterEach(async () => { mark(false); releases.forEach(release => release()); await settle(); api.defaults.adapter = originalAdapter; });

describe('in-flight administrator results during a temporary publication pause', () => {
  it.each(['orders', 'after-sales', 'coupons'] as const)('starts a %s read when a tab opened during publication becomes ready', async page => {
    let reads = 0;
    serve(() => { reads++; return page === 'orders' ? orders() : page === 'after-sales' ? afterSales : { data: [], pagination: { total: 0, page: 1, page_size: 50 } }; });
    mark(true);
    render(page === 'orders' ? <OrdersPage /> : page === 'after-sales' ? <AfterSalesPage /> : <CouponsPage />); await settle();
    expect(reads).toBe(0);
    mark(false); await settle();
    expect(reads).toBe(1);
    expect(screen.queryByText('加载中...')).toBeNull();
  });
  it.each(['orders', 'after-sales'] as const)('restores a held %s read after rejected sign-in preserves A', async page => {
    const gate = deferred(); releases.push(() => gate.resolve(page === 'orders' ? orders() : afterSales));
    let reads = 0;
    serve(() => { reads++; return gate.promise; });
    render(page === 'orders' ? <OrdersPage /> : <AfterSalesPage />); await settle();
    expect(reads).toBe(1);
    mark(true); await settle();
    await act(async () => gate.resolve(page === 'orders' ? orders() : afterSales)); await settle();
    expect(screen.queryByText(page === 'orders' ? 'PAUSED-ORDER' : '订单号：PAUSED-SERVICE')).toBeNull();
    mark(false); await settle();
    expect(screen.getByText(page === 'orders' ? 'PAUSED-ORDER' : '订单号：PAUSED-SERVICE')).toBeInTheDocument();
    expect(reads).toBe(1);
  });

  it('completes a committed shipment and unlocks its controls after A resumes without another PUT', async () => {
    const gate = deferred(); releases.push(() => gate.resolve({ status: 2 }));
    let writes = 0, stored = 1;
    serve(config => {
      if (config.method === 'put') { writes++; stored = 2; return gate.promise; }
      return orders(stored);
    });
    render(<OrdersPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '发货' })); await settle();
    fireEvent.change(screen.getByLabelText('快递公司'), { target: { value: 'SF Express' } });
    fireEvent.change(screen.getByLabelText('运单号'), { target: { value: 'SF123456' } });
    const form = document.querySelector('form:not([role="search"])')!;
    const stale = captureHandler(form, 'onSubmit'); fireEvent.submit(form); await settle();
    mark(true); await settle();
    await act(async () => gate.resolve({ status: 2 })); await settle();
    await stale(); await settle(); expect(writes).toBe(1);
    mark(false); await settle();
    expect(screen.getByText('已发货', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认发货' })).toBeNull();
    expect(screen.getByRole('button', { name: '完成订单' })).toBeEnabled();
    await stale(); await settle(); expect(writes).toBe(1);
  });

  it('retires an unknown inventory draft after A resumes, preserving a subsequent buyer deduction', async () => {
    const gate = deferred(); releases.push(() => gate.resolve({}));
    let writes = 0, stock = 2, config: InternalAxiosRequestConfig | undefined;
    serve(request => {
      if (request.url === '/products/categories') return [{ category_id: 1, name: '分类' }];
      if (request.method === 'put') { writes++; stock = 4; config = request; return gate.promise; }
      return products(stock);
    });
    render(<ProductsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '编辑' })); await settle();
    fireEvent.change(screen.getByLabelText('库存'), { target: { value: '5' } });
    const stale = captureHandler(screen.getByRole('button', { name: '保存修改' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' })); await settle();
    mark(true); await settle();
    await act(async () => gate.reject(new AxiosError('Response lost', AxiosError.ERR_NETWORK, config))); await settle();
    await stale(); await settle(); expect(writes).toBe(1);
    mark(false); await settle();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
    expect(toast.success).not.toHaveBeenCalledWith('商品更新成功');
    fireEvent.click(screen.getByRole('button', { name: '编辑' })); await settle();
    expect(screen.getByLabelText('库存')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' })); await settle();
    expect(writes).toBe(1); expect(stock).toBe(4);
  });

  it('finishes an in-flight inventory recovery read after A resumes instead of leaving checking locked', async () => {
    const gate = deferred(); releases.push(() => gate.resolve(products(4)));
    let reads = 0, writes = 0;
    serve(config => {
      if (config.url === '/products/categories') return [{ category_id: 1, name: '分类' }];
      if (config.method === 'put') { writes++; return {}; }
      return ++reads === 2 ? gate.promise : products(reads === 1 ? 2 : 4);
    });
    render(<ProductsPage />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '编辑' })); await settle();
    fireEvent.change(screen.getByLabelText('库存'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' })); await settle();
    expect(reads).toBe(2);
    mark(true); await settle(); await act(async () => gate.resolve(products(4))); await settle();
    mark(false); await settle();
    expect(screen.queryByRole('button', { name: '重新核对商品' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toBeEnabled();
    expect(writes).toBe(1);
  });

  it('releases an old result when B replaces A and preserves B against a delayed 401', async () => {
    const gate = deferred(); releases.push(() => gate.resolve({}));
    let config: InternalAxiosRequestConfig | undefined;
    serve(request => { config = request; return gate.promise; });
    const call = api.get('/admin/profile'); const rejected = expect(call).rejects.toMatchObject({ response: { status: 401 } });
    mark(true);
    gate.reject(new AxiosError('Expired', AxiosError.ERR_BAD_REQUEST, config, undefined, { config: config!, status: 401, statusText: 'Unauthorized', headers: {}, data: {} }));
    await settle();
    act(() => startAdminSession(second)); await rejected;
    expect(JSON.parse(localStorage.getItem('admin_user')!)).toEqual(second);
    expect(window.location.pathname).toBe('/');
  });

  it('keeps public and cleanup acknowledgements available while protected admin results wait', async () => {
    serve(() => ({ message: '已退出登录' })); mark(true);
    await expect(api.get('/products')).resolves.toEqual({ message: '已退出登录' });
    await expect(api.post('/admin/logout')).resolves.toEqual({ message: '已退出登录' });
  });

  it('does not deliver through the brief marker clearing between cookie cleanup and the next sign-in', async () => {
    const gate = deferred(); releases.push(() => gate.resolve({ admin: first }));
    serve(() => gate.promise);
    let delivered = false;
    const result = api.get('/admin/profile').then(value => { delivered = true; return value; });
    mark(true); gate.resolve({ admin: first }); await settle();
    expect(delivered).toBe(false);
    mark(false);
    // clearCookie resolves an await before adminSignIn marks its next cookie write.
    await Promise.resolve(); mark(true); await settle();
    expect(delivered).toBe(false);
    mark(false); await expect(result).resolves.toEqual({ admin: first });
    expect(delivered).toBe(true);
  });
});
