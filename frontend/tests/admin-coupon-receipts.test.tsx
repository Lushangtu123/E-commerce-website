import { fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import AdminCouponsPage from '@/app/admin/coupons/page';
import api from '@/lib/api';
import { render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const coupon = (status = 1) => ({
  coupon_id: 7, code: 'SAVE', name: 'Saved coupon', description: '', type: 1,
  discount_value: 10, min_amount: 50, max_discount: 0, total_quantity: 100, remain_quantity: 80,
  received_count: 20, used_count: 5, per_user_limit: 1, status,
  start_time: '2026-11-01T10:00:00.000Z', end_time: '2026-12-01T10:00:00.000Z', created_at: '2026-01-01T00:00:00Z',
});
const list = (rows: (ReturnType<typeof coupon> | ReturnType<typeof matched>)[] = [coupon()]) => ({ data: rows, pagination: { page: 1, page_size: 50, total: rows.length, total_pages: Math.ceil(rows.length / 50) } });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const field = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);
const originalAdapter = api.defaults.adapter;
let reads: string[], writes: { url: string; input: Record<string, unknown> }[];
let read: (url: string) => unknown;
let write: (input: Record<string, unknown>) => unknown;

async function mount() { const view = render(<AdminCouponsPage />); await settle(); return view; }
async function click(name: string) { fireEvent.click(button(name)); await settle(); }
async function draft() {
  await click('+ 创建优惠券');
  const values = [[/^优惠券代码/, 'SAVE'], [/^优惠券名称/, 'Saved coupon'], [/^优惠值/, '10'], [/^最低消费金额/, '50'],
    [/^生效时间/, '2026-11-01T10:00'], [/^失效时间/, '2026-12-01T10:00']] as const;
  for (const [name, value] of values) fireEvent.change(field(name), { target: { value } });
}
async function submit() { fireEvent.submit(button('创建').closest('form')!); await settle(); }
const failed = (status?: number, message = '创建失败') => ({ response: status === undefined ? undefined : { status, data: { message } } });
const matched = (input: Record<string, unknown>) => ({ ...coupon(), ...input, discount_value: String(input.discount_value), min_amount: String(input.min_amount) });

beforeEach(() => {
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ username: 'Admin' }));
  reads = []; writes = [];
  read = url => url === '/admin/coupons' ? list() : { success: true, data: coupon(0) };
  write = () => { throw failed(); };
  const adapter: AxiosAdapter = async config => {
    let data;
    if (config.method === 'get') { reads.push(config.url!); data = await read(config.url!); }
    else {
      const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      writes.push({ url: config.url!, input }); data = await write(input);
    }
    return { data, config, status: 200, statusText: 'OK', headers: {} };
  };
  api.defaults.adapter = adapter;
});
afterEach(() => { api.defaults.adapter = originalAdapter; });


describe('coupon success receipts', () => {
  it.each([{}, { success: false }, { success: true, data: { coupon_id: 7 } }])('does not clear an unconfirmed creation after %j', async response => {
    write = () => response;
    read = url => { if (url === '/admin/coupons') return list(); throw new Error('Offline'); };
    await mount(); await draft(); await submit();
    expect(toast.success).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).not.toBeNull();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(reads).toContain('/admin/coupons/by-code/SAVE');
    await click('重新确认优惠券结果'); expect(writes).toHaveLength(1);
  });
  it('confirms creation fields through the unique code before clearing its receipt', async () => {
    write = () => ({});
    read = url => url === '/admin/coupons' ? list(writes.length ? [matched(writes[0].input)] : [coupon()]) : { success: true, data: matched(writes[0].input) };
    await mount(); await draft(); await submit();
    expect(reads).toContain('/admin/coupons/by-code/SAVE');
    expect(toast.success).toHaveBeenCalledWith('创建成功！');
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).toBeNull();
    expect(writes).toHaveLength(1);
  });
  it('does not report a status change that the canonical coupon contradicts', async () => {
    write = () => ({});
    read = url => url === '/admin/coupons' ? list([coupon(1)]) : { success: true, data: coupon(1) };
    await mount(); await click('禁用');
    expect(reads).toContain('/admin/coupons/7');
    expect(toast.success).not.toHaveBeenCalled();
    expect(button('禁用')).toBeEnabled(); expect(writes).toHaveLength(1);
  });
  it('confirms a nominal status acknowledgement through the canonical coupon', async () => {
    write = () => ({ success: true, message: '更新成功' });
    read = url => url === '/admin/coupons' ? list([coupon(writes.length ? 0 : 1)]) : { success: true, data: coupon(0) };
    await mount(); await click('禁用');
    expect(reads).toContain('/admin/coupons/7');
    expect(toast.success).toHaveBeenCalledWith('状态更新成功！');
    expect(button('启用')).toBeEnabled(); expect(writes).toHaveLength(1);
  });
  it('keeps stale rows hidden if a later confirmation fails before refreshing the list', async () => {
    let retry = false; write = () => ({});
    read = url => {
      if (url === '/admin/coupons') { if (writes.length) throw new Error('List offline'); return list(); }
      if (retry) throw new Error('Detail offline');
      return { success: true, data: coupon(0) };
    };
    await mount(); await click('禁用');
    expect(screen.queryByText('Saved coupon')).not.toBeInTheDocument();
    retry = true; await click('重新确认优惠券结果');
    expect(screen.queryByText('Saved coupon')).not.toBeInTheDocument();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).not.toBeNull();
    expect(writes).toHaveLength(1);
  });
  it('keeps the receipt locked when a valid list contradicts the canonical status', async () => {
    let fresh = false; write = () => ({});
    read = url => url === '/admin/coupons' ? list([coupon(fresh ? 0 : 1)]) : { success: true, data: coupon(0) };
    await mount(); await click('禁用');
    expect(toast.success).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).not.toBeNull();
    expect(button('+ 创建优惠券')).toBeDisabled();
    fresh = true; await click('重新确认优惠券结果');
    expect(toast.success).toHaveBeenCalledWith('状态更新成功！'); expect(writes).toHaveLength(1);
    expect(button('启用')).toBeEnabled();
  });

});
