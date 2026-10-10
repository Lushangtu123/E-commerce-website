import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import AdminCouponsPage from '@/app/admin/coupons/page';
import api from '@/lib/api';
import { logger } from '@/lib/logger';
import { CommitLog, apiError, captureHandler, clickTogether, deferred, reactHandler, render, settle, submitTogether } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

type Params = { page: number; page_size: number; status?: number };
type Read = { params: Params; session: string | null };
type Write = { url?: string; method?: string; data: Record<string, unknown>; session: string | null };
const coupon = (id = 1, name = 'Current coupon', status = 1) => ({
  coupon_id: id, code: `SAVE${id}`, name, type: 1, discount_value: 10, min_amount: 50, max_discount: 0,
  total_quantity: 100, remain_quantity: 40, received_count: 60, used_count: 12, per_user_limit: 1,
  start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', status, created_at: '2026-01-01T00:00:00Z',
});
const result = (rows = [coupon()], total = rows.length) => ({
  data: rows, pagination: { page: 1, page_size: 50, total, total_pages: Math.ceil(total / 50) },
});
const originalAdapter = api.defaults.adapter;
let reads: Read[];
let writes: Write[];

function signIn(session: string | null) {
  if (session) {
    localStorage.setItem('admin_session', session);
    localStorage.setItem('admin_user', JSON.stringify({ username: session }));
  } else {
    localStorage.removeItem('admin_session');
    localStorage.removeItem('admin_user');
  }
}
function announceSession() {
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })); });
}

async function setup({ list = () => result(), mutate = async () => ({}), detail }: {
  list?: (call: Read) => unknown;
  mutate?: (call: Write) => unknown;
  detail?: (call: Write) => unknown;
} = {}) {
  signIn('admin-a');
  const adapter: AxiosAdapter = async config => {
    const session = localStorage.getItem('admin_session');
    let data;
    if (config.method === 'get' && config.url !== '/admin/coupons') {
      const write = writes.at(-1)!;
      data = { success: true, data: detail ? detail(write) : { ...coupon(Number(config.url?.split('/').at(-1)) || 1000), ...(write.url?.endsWith('/status') ? { status: write.data.status } : write.data) } };
    } else if (config.method === 'get') {
      const call = { params: config.params as Params, session };
      reads.push(call);
      data = await list(call);
      if (data && typeof data === 'object' && 'pagination' in data) data = { ...data, pagination: { ...(data.pagination as object), page: call.params.page } };
    } else {
      const call = { url: config.url, method: config.method, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, session };
      writes.push(call);
      data = await mutate(call);
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><AdminCouponsPage /></CommitLog>);
  await settle();
  return { view, commits };
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const statusFilter = () => screen.getByRole('combobox', { name: '优惠券状态' });
const field = (label: RegExp) => screen.getByLabelText<HTMLInputElement>(label);
async function click(name: string) { fireEvent.click(button(name)); await settle(); }
async function filter(status: string) { fireEvent.change(statusFilter(), { target: { value: status } }); await settle(); }
async function openDraft(name = 'Draft') {
  await click('+ 创建优惠券');
  fireEvent.change(field(/^优惠券代码/), { target: { value: 'draft' } });
  fireEvent.change(field(/^优惠券名称/), { target: { value: name } });
  fireEvent.change(field(/^优惠值/), { target: { value: '10' } });
  fireEvent.change(field(/^生效时间/), { target: { value: '2026-11-01T10:00' } });
  fireEvent.change(field(/^失效时间/), { target: { value: '2026-12-01T10:00' } });
}
const form = () => button('创建').closest('form')!;
async function submit() { fireEvent.submit(form()); await settle(); }

beforeEach(() => { reads = []; writes = []; });
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('admin coupon recovery and pagination', () => {
  it('consumes server pagination to reach coupons after the first fifty', async () => {
    await setup({ list: ({ params }) => params.page === 2
      ? result([coupon(51, 'Last coupon')], 51) : result([coupon(1, 'First coupon')], 51) });
    expect(reads[0].params).toMatchObject({ page: 1, page_size: 50 });
    expect(screen.getByText('共 51 张优惠券')).toBeInTheDocument();
    expect(button('上一页')).toBeDisabled();
    await click('下一页');
    expect(reads.at(-1)?.params.page).toBe(2);
    expect(screen.getByText('Last coupon')).toBeInTheDocument();
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    expect(button('下一页')).toBeDisabled();
    await click('上一页');
    expect(screen.getByText('First coupon')).toBeInTheDocument();
  });

  it('returns to page one when the existing enabled or disabled filter changes', async () => {
    await setup({ list: ({ params }) => result([coupon(1, params.status === 0 ? 'Disabled coupon' : 'Enabled coupon', params.status ?? 1)], 51) });
    await click('下一页');
    await filter('0');
    expect(reads.at(-1)?.params).toMatchObject({ page: 1, status: 0 });
    expect(screen.getByText('Disabled coupon')).toBeInTheDocument();
    await filter('1');
    expect(reads.at(-1)?.params.status).toBe(1);
    await filter('');
    expect(reads.at(-1)?.params.status).toBeUndefined();
  });

  it('shows a retry instead of an empty list and deduplicates pending retries', async () => {
    const retry = deferred();
    await setup({ list: () => reads.length === 1 ? Promise.reject(apiError('获取优惠券列表失败')) : retry.promise });
    expect(screen.getByRole('alert')).toHaveTextContent('获取优惠券列表失败');
    expect(screen.queryByText('暂无优惠券')).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledOnce();
    const repeat = captureHandler(button('重新加载'));
    const one = repeat();
    const two = repeat();
    await settle();
    expect(reads).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => retry.resolve(result()));
    await Promise.all([one, two]);
    await settle();
    expect(screen.getByText('Current coupon')).toBeInTheDocument();
  });

  it('hides earlier rows if a mutation refresh fails', async () => {
    await setup({ list: () => reads.length === 1 ? result() : Promise.reject(apiError('更新后的列表失败')) });
    await click('禁用');
    expect(screen.getByRole('alert')).toHaveTextContent('优惠券提交结果尚未确认');
    expect(toast.success).not.toHaveBeenCalled();
    expect(button('+ 创建优惠券')).toBeDisabled();
    expect(screen.queryByText('Current coupon')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无优惠券')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)('ignores a late previous-filter %s', async outcome => {
    const old = deferred();
    await setup({ list: ({ params }) => params.status === 0 ? result([coupon(2, 'Filtered coupon', 0)]) : old.promise });
    await filter('0');
    await act(async () => {
      if (outcome === 'success') old.resolve(result([coupon(1, 'Old filter')]));
      else old.reject(apiError('旧筛选错误'));
    });
    await settle();
    expect(screen.getByText('Filtered coupon')).toBeInTheDocument();
    expect(screen.queryByText('Old filter')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('clamps the final filtered page after disabling its only coupon', async () => {
    let total = 51;
    const { commits } = await setup({
      list: ({ params }) => result(total === 50 && params.page === 2 ? [] : [coupon(params.page === 2 ? 51 : 1)], total),
      mutate: () => { total = 50; return {}; },
    });
    await filter('1');
    await click('下一页');
    const before = commits.length;
    await click('禁用');
    expect(reads.at(-1)?.params).toMatchObject({ page: 1, status: 1 });
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    expect(button('下一页')).toBeDisabled();
    expect(commits.slice(before).every(commit => !commit.textContent?.includes('暂无优惠券'))).toBe(true);
  });
});

describe('admin coupon mutation locks', () => {
  it('sends one create and keeps competing actions disabled until its refresh finishes', async () => {
    const write = deferred();
    const refresh = deferred();
    await setup({ list: () => reads.length === 1 ? result() : refresh.promise, mutate: () => write.promise });
    await openDraft();
    submitTogether(form(), form());
    await settle();
    expect(writes).toHaveLength(1);
    expect(button('创建')).toBeDisabled();
    expect(button('取消')).toBeDisabled();
    expect(button('禁用')).toBeDisabled();
    expect(field(/^优惠券名称/)).toBeDisabled();
    await act(async () => write.resolve({}));
    await settle();
    expect(reads).toHaveLength(2);
    expect(button('+ 创建优惠券')).toBeDisabled();
    await act(async () => refresh.resolve(result()));
    await settle();
    expect(button('+ 创建优惠券')).toBeEnabled();
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it('sends one status change and blocks creation until its refresh finishes', async () => {
    const write = deferred();
    const refresh = deferred();
    await setup({ list: () => reads.length === 1 ? result() : refresh.promise, mutate: () => write.promise });
    clickTogether(button('禁用'), button('禁用'));
    await settle();
    expect(writes).toHaveLength(1);
    expect(button('禁用')).toBeDisabled();
    expect(button('+ 创建优惠券')).toBeDisabled();
    await act(async () => write.resolve({}));
    await settle();
    expect(button('禁用')).toBeDisabled();
    await act(async () => refresh.resolve(result([coupon(1, 'Current coupon', 0)])));
    await settle();
    expect(button('启用')).toBeEnabled();
  });

  it('rejects an old row handler after a replacement response for the same filter', async () => {
    await setup({
      list: () => result([coupon(1, `Version ${reads.length}`, writes.length ? 0 : 1)]),
      detail: () => coupon(1, 'Version 2', 0),
    });
    const stale = captureHandler(button('禁用'));
    await click('禁用');
    await stale();
    await settle();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(writes).toHaveLength(1);
  });

  it('retires old row handlers as soon as a filter changes before React commits', async () => {
    await setup();
    const action = button('禁用');
    act(() => { fireEvent.change(statusFilter(), { target: { value: '0' } }); action.click(); });
    await settle();
    expect(writes).toHaveLength(0);
  });
});

describe('admin coupon session isolation', () => {
  it.each(['success', 'failure'] as const)('clears old rows, filter, page and draft immediately and ignores late list %s', async outcome => {
    const old = deferred();
    const { commits } = await setup({ list: call => call.session === 'admin-b'
      ? result([coupon(2, 'Admin B coupon')]) : call.params.status === 0 ? old.promise : result([coupon(1, 'Admin A coupon')], 51) });
    await openDraft('Private draft');
    await click('取消');
    await click('下一页');
    await filter('0');
    const before = commits.length;
    signIn('admin-b'); announceSession();
    expect(commits[before].textContent).not.toContain('Admin A coupon');
    expect(commits[before].querySelector('form')).toBeNull();
    expect(commits[before].querySelector<HTMLSelectElement>('select[aria-label="优惠券状态"]')?.value).toBe('');
    await settle();
    expect(reads.at(-1)).toMatchObject({ session: 'admin-b', params: { page: 1 } });
    expect(reads.at(-1)?.params.status).toBeUndefined();
    await click('+ 创建优惠券');
    expect(field(/^优惠券代码/)).toHaveValue('');
    expect(field(/^优惠券名称/)).toHaveValue('');
    expect(field(/^生效时间/)).toHaveValue('');
    fireEvent.change(field(/^优惠券名称/), { target: { value: 'Admin B draft' } });
    await act(async () => {
      if (outcome === 'success') old.resolve(result([coupon(3, 'Late admin A coupon')]));
      else old.reject(apiError('旧身份错误'));
    });
    await settle();
    expect(screen.getByText('Admin B coupon')).toBeInTheDocument();
    expect(screen.queryByText('Late admin A coupon')).not.toBeInTheDocument();
    expect(field(/^优惠券名称/)).toHaveValue('Admin B draft');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(['create', 'toggle'] as const)('ignores late %s success and does not reset the next administrator draft', async kind => {
    const old = deferred();
    const replacement = deferred();
    await setup({ mutate: call => call.session === 'admin-a' ? old.promise : replacement.promise });
    if (kind === 'create') { await openDraft(); await submit(); }
    else await click('禁用');
    signIn('admin-b'); announceSession();
    await settle();
    await openDraft('Admin B draft');
    await submit();
    expect(writes).toHaveLength(2);
    const before = reads.length;
    await act(async () => old.resolve({}));
    await settle();
    expect(field(/^优惠券名称/)).toHaveValue('Admin B draft');
    expect(reads).toHaveLength(before);
    expect(toast.success).not.toHaveBeenCalled();
    expect(button('创建')).toBeDisabled();
    expect(button('取消')).toBeDisabled();
    await act(async () => replacement.reject(apiError('新身份可重试错误')));
    await settle();
    expect(field(/^优惠券名称/)).toHaveValue('Admin B draft');
    expect(button('创建')).toBeEnabled();
    expect(toast.error).toHaveBeenCalledWith('新身份可重试错误');
  });

  it.each(['create', 'toggle'] as const)('ignores late %s failures after another administrator signs in', async kind => {
    const old = deferred();
    await setup({ mutate: () => old.promise });
    if (kind === 'create') { await openDraft(); await submit(); }
    else await click('禁用');
    signIn('admin-b'); announceSession();
    await settle();
    await openDraft('Admin B draft');
    await act(async () => old.reject(apiError('旧身份写入错误')));
    await settle();
    expect(field(/^优惠券名称/)).toHaveValue('Admin B draft');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejects stale form and row handlers even before an account change event', async () => {
    await setup();
    await openDraft();
    const staleSubmit = captureHandler(form(), 'onSubmit');
    const staleToggle = captureHandler(button('禁用'));
    const staleChange = reactHandler(field(/^优惠券名称/), 'onChange');
    signIn('admin-b');
    await staleSubmit(); await staleToggle();
    act(() => { staleChange({ target: { value: 'Leaked draft' } }); });
    expect(writes).toHaveLength(0);
    announceSession(); await settle();
    await openDraft('Admin B draft');
    await staleSubmit(); await staleToggle();
    act(() => { staleChange({ target: { value: 'Leaked draft' } }); });
    await settle();
    expect(writes).toHaveLength(0);
    expect(field(/^优惠券名称/)).toHaveValue('Admin B draft');
  });

  it('clears the open draft and rows on logout without issuing more reads', async () => {
    const { commits } = await setup();
    await openDraft('Private draft');
    const before = commits.length;
    signIn(null); announceSession(); await settle();
    expect(commits[before].textContent).not.toContain('Current coupon');
    expect(commits[before].querySelector('form')).toBeNull();
    expect(screen.queryByRole('heading', { name: '创建优惠券' })).not.toBeInTheDocument();
    expect(reads).toHaveLength(1);
    expect(button('+ 创建优惠券')).toBeDisabled();
  });
});
