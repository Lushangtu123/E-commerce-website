import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import AdminCouponsPage from '@/app/admin/coupons/page';
import api from '@/lib/api';
import { captureHandler, deferred, render, settle } from './helpers';
import { useLocaleStore } from '@/store/useLocaleStore';

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

describe('unknown coupon status writes', () => {
  it.each(['wrong page', 'wrong page size', 'wrong totals', 'wrong filter'] as const)('rejects a canonical-looking list with %s', async failure => {
    read = url => {
      if (url !== '/admin/coupons') return { success: true, data: coupon(0) };
      const value = list([coupon(failure === 'wrong filter' ? 1 : 0)]);
      if (writes.length) {
        if (failure === 'wrong page') value.pagination.page = 2;
        if (failure === 'wrong page size') value.pagination.page_size = 20;
        if (failure === 'wrong totals') value.pagination.total_pages = 12;
      }
      return value;
    };
    await mount();
    if (failure === 'wrong filter') {
      fireEvent.change(screen.getByRole('combobox', { name: '优惠券状态' }), { target: { value: '1' } }); await settle();
      // This recovery list claims to be the enabled filter while returning a disabled row.
      read = url => url === '/admin/coupons' ? list([coupon(writes.length ? 0 : 1)]) : { success: true, data: coupon(0) };
      await click('禁用');
    } else await click('启用');
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(button('重新确认优惠券结果')).toBeEnabled();
    expect(writes).toHaveLength(1);
  });

  it('keeps reconciliation locked if navigation retires its list read and allows a fresh read on the new filter', async () => {
    const oldList = deferred();
    let old = true;
    read = url => url === '/admin/coupons' ? writes.length && old ? oldList.promise : list([coupon(0)]) : { success: true, data: coupon(0) };
    await mount(); await click('启用');
    old = false;
    fireEvent.change(screen.getByRole('combobox', { name: '优惠券状态' }), { target: { value: '0' } });
    await settle();
    await act(async () => oldList.resolve(list([coupon()]))); await settle();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    await click('重新确认优惠券结果');
    expect(button('启用')).toBeEnabled();
    expect(writes).toHaveLength(1);
  });

  it('retains recovery when storage cleanup fails after a valid read', async () => {
    read = url => url === '/admin/coupons' ? list([coupon(writes.length ? 0 : 1)]) : { success: true, data: coupon(0) };
    await mount();
    const remove = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('storage blocked'); });
    await click('禁用');
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).not.toBeNull();
    remove.mockRestore();
    await click('重新确认优惠券结果');
    expect(button('+ 创建优惠券')).toBeEnabled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).toBeNull();
  });

  it.each([undefined, 408, 500, 503])('reads the coupon by ID after a lost %s acknowledgement and retires stale rows', async status => {
    let canonical = coupon();
    write = () => { canonical = coupon(0); throw failed(status); };
    read = url => url === '/admin/coupons' ? list([canonical]) : { success: true, data: canonical };
    await mount();
    const stale = captureHandler(button('禁用'));
    await click('禁用');
    expect(reads).toContain('/admin/coupons/7');
    expect(button('启用')).toBeEnabled();
    await stale(); await settle();
    expect(writes).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(['failed', 'malformed', 'wrong ID', 'bad list'] as const)('keeps all writes locked after a %s reconciliation and retries only reads', async failure => {
    let healthy = false;
    read = url => {
      if (url === '/admin/coupons') return failure === 'bad list' && writes.length && !healthy ? { data: [{}] } : list([coupon(healthy ? 0 : 1)]);
      if (healthy) return { success: true, data: coupon(0) };
      if (failure === 'failed') throw failed(503);
      return { success: true, data: failure === 'wrong ID' ? { ...coupon(0), coupon_id: 9 } : failure === 'bad list' ? coupon(0) : { coupon_id: 7, status: 0 } };
    };
    await mount(); await click('禁用');
    expect(button('+ 创建优惠券')).toBeDisabled();
    if (failure === 'bad list') expect(screen.queryByText('Saved coupon')).not.toBeInTheDocument();
    else expect(button('禁用')).toBeDisabled();
    healthy = true;
    await click('重新确认优惠券结果');
    expect(writes).toHaveLength(1);
    expect(button('启用')).toBeEnabled();
  });

  it('keeps recovery across navigation and ignores the unmounted completion', async () => {
    const detail = deferred();
    read = url => url === '/admin/coupons' ? list() : detail.promise;
    const view = await mount(); await click('禁用'); view.unmount();
    read = url => url === '/admin/coupons' ? list([coupon(0)]) : { success: true, data: coupon(0) };
    await mount();
    expect(button('+ 创建优惠券')).toBeDisabled();
    await click('重新确认优惠券结果');
    await act(async () => detail.resolve({ success: true, data: coupon() })); await settle();
    expect(button('启用')).toBeEnabled();
    expect(writes).toHaveLength(1);
  });
});

describe('unknown coupon creations', () => {
  it('restores a pending request with all submitted fields locked until its explicit read', async () => {
    const pending = deferred(); write = () => pending.promise;
    const view = await mount(); await draft(); await submit(); view.unmount();
    await mount();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(reads.filter(url => url.includes('by-code'))).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: '创建优惠券' })).not.toBeInTheDocument();
    await act(async () => pending.reject(failed(503))); await settle();
    expect(button('+ 创建优惠券')).toBeDisabled();
  });

  it('keeps malformed stored recovery blocked and preserves its evidence', async () => {
    sessionStorage.setItem('pending-admin-coupon-write:admin-a', '{broken');
    await mount();
    expect(button('+ 创建优惠券')).toBeDisabled();
    await click('重新读取待确认请求');
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(sessionStorage.getItem('pending-admin-coupon-write:admin-a')).toBe('{broken');
    expect(writes).toHaveLength(0);
  });

  it('does not infer absence from a failed code lookup even when the list is empty', async () => {
    read = url => { if (url === '/admin/coupons') return list([]); throw failed(404, '接口不存在'); };
    await mount(); await draft(); await submit();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(button('重新确认优惠券结果')).toBeEnabled();
    expect(screen.queryByRole('button', { name: '重试原创建请求' })).not.toBeInTheDocument();
  });

  it('reconciles a duplicate-code response on explicit replay rather than losing the uncertain intent', async () => {
    let canonical: unknown = null;
    read = url => url === '/admin/coupons' ? list([]) : { success: true, data: canonical };
    await mount(); await draft(); await submit();
    canonical = { ...matched(writes[0].input), code: 'save', max_discount: null };
    write = () => { throw failed(400, '优惠券代码已存在'); };
    await click('重试原创建请求');
    expect(writes).toHaveLength(2);
    expect(button('+ 创建优惠券')).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '创建优惠券' })).not.toBeInTheDocument();
  });

  it('renders read-only recovery and its result in English', async () => {
    let healthy = false;
    read = url => {
      if (url === '/admin/coupons') return list(healthy ? [matched(writes[0].input)] : [coupon()]);
      if (!healthy) throw failed(503);
      return { success: true, data: matched(writes[0].input) };
    };
    await mount(); await draft(); await submit();
    act(() => useLocaleStore.getState().setLocale('en')); await settle();
    expect(button('Confirm coupon result again')).toBeEnabled();
    expect(button('+ Create coupon')).toBeDisabled();
    healthy = true;
    await click('Confirm coupon result again');
    expect(toast.error).toHaveBeenCalledWith('The original coupon creation was confirmed. Check the current list');
  });

  it('confirms a committed creation by its stable code and submitted fields without replaying POST', async () => {
    read = url => url === '/admin/coupons' ? list(writes.length ? [matched(writes[0].input)] : [coupon()]) : { success: true, data: matched(writes[0].input) };
    await mount(); await draft(); await submit();
    expect(reads).toContain('/admin/coupons/by-code/SAVE');
    expect(screen.queryByRole('heading', { name: '创建优惠券' })).not.toBeInTheDocument();
    await click('+ 创建优惠券');
    expect(field(/^优惠券代码/)).toHaveValue('');
    expect(writes).toHaveLength(1);
  });

  it('does not infer absence from an empty list and only explicitly retries the original payload after a code lookup', async () => {
    read = url => url === '/admin/coupons' ? list([]) : { success: true, data: null };
    await mount(); await draft(); await submit();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(writes).toHaveLength(1);
    expect(button('重试原创建请求')).toBeEnabled();
    write = () => ({ success: true, data: { coupon_id: 7 } });
    read = url => url === '/admin/coupons' ? list(writes.length ? [matched(writes[0].input)] : [coupon()]) : { success: true, data: matched(writes[0].input) };
    await click('重试原创建请求');
    expect(writes).toHaveLength(2);
    expect(writes[1].input).toEqual(writes[0].input);
    expect(button('+ 创建优惠券')).toBeEnabled();
  });

  it('retains a draft when the code belongs to a different coupon', async () => {
    read = url => {
      const canonical = writes.length ? { ...matched(writes[0].input), name: 'Another creation' } : coupon();
      return url === '/admin/coupons' ? list([canonical]) : { success: true, data: canonical };
    };
    await mount(); await draft(); await submit();
    expect(field(/^优惠券名称/)).toHaveValue('Saved coupon');
    expect(field(/^优惠券名称/)).toBeEnabled();
    expect(toast.error).toHaveBeenCalledWith('该代码对应的优惠券与原创建内容不一致，请核对后修改草稿');
    expect(writes).toHaveLength(1);
  });

  it('persists the submitted intent before POST so interrupted navigation can safely confirm it', async () => {
    const pending = deferred(); write = () => pending.promise;
    const view = await mount(); await draft(); await submit(); view.unmount();
    read = url => url === '/admin/coupons' ? list(writes.length ? [matched(writes[0].input)] : [coupon()]) : { success: true, data: matched(writes[0].input) };
    await mount();
    expect(button('+ 创建优惠券')).toBeDisabled();
    await click('重新确认优惠券结果');
    expect(button('+ 创建优惠券')).toBeEnabled();
    expect(writes).toHaveLength(1);
    await act(async () => pending.resolve({ success: true })); await settle();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(['read fails', 'malformed', 'wrong code', 'negative amount'] as const)('does not unlock or replay a creation when its lookup %s', async failure => {
    read = url => {
      if (url === '/admin/coupons') return list([]);
      if (failure === 'read fails') throw failed(500);
      return { success: true, data: failure === 'malformed' ? {} : { ...matched(writes[0].input),
        ...(failure === 'wrong code' ? { code: 'OTHER' } : { discount_value: -1 }) } };
    };
    await mount(); await draft(); await submit();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(button('重新确认优惠券结果')).toBeEnabled();
    expect(screen.queryByRole('button', { name: '重试原创建请求' })).not.toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it.each([400, 403, 409, 422])('preserves an editable draft for a definitive %s error', async status => {
    write = () => { throw failed(status, '优惠券代码已存在'); };
    await mount(); await draft(); await submit();
    expect(field(/^优惠券名称/)).toHaveValue('Saved coupon');
    expect(field(/^优惠券名称/)).toBeEnabled();
    expect(reads).toEqual(['/admin/coupons']);
    expect(toast.error).toHaveBeenCalledWith('优惠券代码已存在');
  });

  it('blocks POST when browser storage cannot preserve recovery intent', async () => {
    await mount(); await draft();
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    await submit();
    expect(writes).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('无法保存优惠券请求，请允许浏览器存储后重试');
  });

  it('does not let an old reconciliation modify the next administrator draft', async () => {
    const pending = deferred();
    read = url => url === '/admin/coupons' ? list() : pending.promise;
    await mount(); await draft(); await submit();
    localStorage.setItem('admin_session', 'admin-b');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })));
    await settle(); await draft();
    fireEvent.change(field(/^优惠券名称/), { target: { value: 'New admin draft' } });
    await act(async () => pending.resolve({ success: true, data: matched(writes[0].input) })); await settle();
    expect(field(/^优惠券名称/)).toHaveValue('New admin draft');
    expect(field(/^优惠券名称/)).toBeEnabled();
  });
});
