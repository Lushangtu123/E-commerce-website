import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import AdminUsersPage from '@/app/admin/users/page';
import AdminOrdersPage from '@/app/admin/orders/page';
import api from '@/lib/api';
import { CommitLog, apiError, captureHandler, deferred, reactHandler, render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

type Kind = 'products' | 'users' | 'orders';
type Params = { page: number; keyword?: string; orderNo?: string; status?: string };
type Call = { params: Params; session: string | null };
const pages = { products: AdminProductsPage, users: AdminUsersPage, orders: AdminOrdersPage };
const labels = {
  products: { keyword: '搜索商品', status: '商品状态', action: '下架' },
  users: { keyword: '搜索用户', status: '用户状态', action: '禁用' },
  orders: { keyword: '订单号', status: '订单状态', action: '取消订单' },
};
const keywordParam = (kind: Kind) => kind === 'orders' ? 'orderNo' : 'keyword';
const row = (kind: Kind, id = 1, title = 'Current rows') => kind === 'products'
  ? { product_id: id, title, price: '10.00', stock: 5, category_id: 1, status: 1 }
  : kind === 'users'
    ? { user_id: id, username: title, status: 1, created_at: '2026-10-02' }
    : { order_id: id, order_no: title, status: 0, total_amount: '10.00', created_at: '2026-10-02' };
const result = (kind: Kind, title = 'Current rows') => ({ [kind]: [row(kind, 1, title)], pagination: { total: 40, totalPages: 2 } });
const originalAdapter = api.defaults.adapter;
let reads: Call[] = [];
let writes: unknown[] = [];

function signIn(session: string) {
  localStorage.setItem('admin_session', session);
  localStorage.setItem('admin_user', JSON.stringify({ username: session }));
}

async function setup(kind: Kind, list: (call: Call) => unknown = () => result(kind)) {
  signIn('admin-a');
  const adapter: AxiosAdapter = async config => {
    let data;
    if (config.url === '/products/categories') data = [];
    else if (config.method === 'get') {
      const call = { params: config.params as Params, session: localStorage.getItem('admin_session') };
      reads.push(call);
      data = await list(call);
    } else { writes.push(config); data = {}; }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const Page = pages[kind];
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><Page /></CommitLog>);
  await settle();
  return { view, commits };
}

const input = (kind: Kind) => screen.getByRole<HTMLInputElement>('textbox', { name: labels[kind].keyword });
const status = (kind: Kind) => screen.getByRole('combobox', { name: labels[kind].status });
const button = (name: string) => screen.getAllByRole<HTMLButtonElement>('button', { name })[0];
async function click(name: string) { fireEvent.click(button(name)); await settle(); }
async function draft(kind: Kind, value: string) { fireEvent.change(input(kind), { target: { value } }); await settle(); }

beforeEach(() => { reads = []; writes = []; vi.stubGlobal('confirm', () => true); });
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe.each(['products', 'users', 'orders'] as const)('admin %s submitted search', kind => {
  it('deduplicates same-condition submits while the refresh is pending', async () => {
    const pending = deferred();
    let requests = 0;
    await setup(kind, () => ++requests === 1 ? result(kind, 'Initial') : pending.promise);
    const form = input(kind).closest('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await settle();
    expect(reads).toHaveLength(2);
    await act(async () => pending.resolve(result(kind, 'Refreshed')));
    await settle();
    expect(screen.getByText('Refreshed')).toBeVisible();
  });
  it.each(['Enter', 'Search'] as const)('keeps typed characters local and makes one page-one request on %s', async method => {
    await setup(kind);
    await click('下一页');
    expect(reads).toHaveLength(2);
    const user = userEvent.setup();
    await user.type(input(kind), 'iphone');
    await settle();
    expect(input(kind)).toHaveValue('iphone');
    expect(reads, 'typing six characters must not start six list reads').toHaveLength(2);
    expect(reads.at(-1)?.params.page).toBe(2);

    if (method === 'Enter') await user.keyboard('{Enter}');
    else await user.click(button('搜索'));
    await settle();
    expect(reads).toHaveLength(3);
    expect(reads.at(-1)?.params).toMatchObject({ page: 1, [keywordParam(kind)]: 'iphone' });
    expect(screen.getByText('第 1 页')).toBeInTheDocument();

    await click('搜索');
    expect(reads, 'submitting the already applied search refreshes it once').toHaveLength(4);
  });

  it('applies status immediately with the submitted keyword, then Reset clears both keyword states', async () => {
    await setup(kind);
    await draft(kind, 'saved');
    await click('搜索');
    await click('下一页');
    const count = reads.length;
    await draft(kind, 'iphone');
    expect(reads).toHaveLength(count);
    fireEvent.change(status(kind), { target: { value: '0' } });
    await settle();
    expect(reads).toHaveLength(count + 1);
    expect(reads.at(-1)?.params).toMatchObject({ page: 1, [keywordParam(kind)]: 'saved', status: '0' });
    expect(input(kind)).toHaveValue('iphone');

    await click('搜索');
    expect(reads).toHaveLength(count + 2);
    expect(reads.at(-1)?.params).toMatchObject({ page: 1, [keywordParam(kind)]: 'iphone', status: '0' });
    await draft(kind, 'unfinished');
    await click('重置');
    expect(reads).toHaveLength(count + 3);
    expect(reads.at(-1)?.params[keywordParam(kind)]).toBeUndefined();
    expect(reads.at(-1)?.params.status).toBeUndefined();
    expect(input(kind)).toHaveValue('');
    expect(status(kind)).toHaveValue('');
  });

  it.each(['success', 'failure'] as const)('starts the next session with no old draft or rows and ignores a late %s', async outcome => {
    const old = deferred();
    const { commits } = await setup(kind, call => call.session === 'admin-b'
      ? result(kind, 'Admin B rows')
      : call.params[keywordParam(kind)] ? old.promise : result(kind, 'Admin A rows'));
    await draft(kind, 'old applied');
    await click('搜索');
    await draft(kind, 'private draft');
    const before = commits.length;
    signIn('admin-b');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })); });
    const first = commits[before];
    expect(first.querySelector<HTMLInputElement>('input[aria-label]')?.value).toBe('');
    expect(first.textContent).not.toContain('Admin A rows');
    await settle();
    expect(reads.at(-1)).toMatchObject({ session: 'admin-b', params: { page: 1 } });
    expect(reads.at(-1)?.params[keywordParam(kind)]).toBeUndefined();
    expect(screen.getByText('Admin B rows')).toBeInTheDocument();

    await act(async () => {
      if (outcome === 'success') old.resolve(result(kind, 'Late old rows'));
      else old.reject(apiError('旧身份错误'));
    });
    await settle();
    expect(input(kind)).toHaveValue('');
    expect(screen.getByText('Admin B rows')).toBeInTheDocument();
    expect(screen.queryByText('Late old rows')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'] as const)('cannot replace newly submitted results with a late previous-filter %s', async outcome => {
    const old = deferred();
    await setup(kind, call => call.params[keywordParam(kind)] ? result(kind, 'Submitted results') : old.promise);
    await draft(kind, 'iphone');
    expect(reads).toHaveLength(1);
    await click('搜索');
    expect(reads).toHaveLength(2);
    expect(screen.getByText('Submitted results')).toBeInTheDocument();

    await act(async () => {
      if (outcome === 'success') old.resolve(result(kind, 'Previous filter results'));
      else old.reject(apiError('旧筛选错误'));
    });
    await settle();
    expect(screen.getByText('Submitted results')).toBeInTheDocument();
    expect(screen.queryByText('Previous filter results')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects stale search, draft, status and reset handlers before and after the account change renders', async () => {
    await setup(kind);
    await draft(kind, 'old draft');
    const staleSubmit = captureHandler(button('搜索').closest('form')!, 'onSubmit');
    const staleReset = captureHandler(button('重置'));
    const staleInput = reactHandler(input(kind), 'onChange');
    const staleStatus = reactHandler(status(kind), 'onChange');
    const before = reads.length;
    signIn('admin-b');
    await staleSubmit();
    await staleReset();
    act(() => { staleInput({ target: { value: 'leaked draft' } }); staleStatus({ target: { value: '0' } }); });
    await settle();
    expect(reads).toHaveLength(before);

    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })); });
    await settle();
    const after = reads.length;
    await staleSubmit();
    await staleReset();
    act(() => { staleInput({ target: { value: 'leaked draft' } }); staleStatus({ target: { value: '0' } }); });
    await settle();
    expect(reads).toHaveLength(after);
    expect(input(kind)).toHaveValue('');
    expect(status(kind)).toHaveValue('');
  });

  it('retires displayed row actions immediately on submission, before the next render', async () => {
    await setup(kind);
    await draft(kind, 'iphone');
    const action = button(labels[kind].action);
    act(() => {
      fireEvent.submit(button('搜索').closest('form')!);
      action.click();
    });
    await settle();
    expect(writes).toEqual([]);
    expect(reads.at(-1)?.params[keywordParam(kind)]).toBe('iphone');
  });
});

it('keeps product selection while editing the draft and clears it when the submitted scope changes', async () => {
  await setup('products');
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  await settle();
  expect(screen.getByText('已选择 1 个商品')).toBeInTheDocument();
  await draft('products', 'iphone');
  expect(screen.getByText('已选择 1 个商品')).toBeInTheDocument();
  expect(reads).toHaveLength(1);
  await click('搜索');
  expect(screen.queryByText('已选择 1 个商品')).not.toBeInTheDocument();
});
