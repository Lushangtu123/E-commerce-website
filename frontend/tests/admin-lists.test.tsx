import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import AdminUsersPage from '@/app/admin/users/page';
import api from '@/lib/api';
import { CommitLog, apiError, captureHandler, deferred, reactHandler, render, settle } from './helpers';

const notifications = vi.hoisted(() => [] as string[]);
// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notifications.push(message); };
  const toast = { success: record, error: record };
  return { default: toast, toast };
});

type Kind = 'products' | 'users';
type Params = { page: number; limit?: number; keyword?: string; status?: string };
type Call = Params & { path?: string; authorization: unknown };
type Mutation = { path?: string; method?: string; body: Record<string, unknown> | undefined; authorization: unknown };

const pages = { products: AdminProductsPage, users: AdminUsersPage };
const statusAction = { products: '下架', users: '禁用' } as const;
const row = (kind: Kind, id: number, title = `Row ${id}`) => kind === 'products'
  ? { product_id: id, title, price: '10.00', stock: 5, category_id: 1, status: 1 }
  : { user_id: id, username: title, status: 1, created_at: '2026-10-02' };
const result = (kind: Kind, rows: unknown[], total = rows.length) => ({ [kind]: rows, pagination: { total, totalPages: Math.ceil(total / 20) } });

const originalAdapter = api.defaults.adapter;
let requests: Call[] = [];
let mutations: Mutation[] = [];

interface Setup {
  list?: (params: Params, authorization: unknown) => unknown;
  mutate?: () => Promise<unknown>;
  categories?: () => Promise<unknown>;
}

/**
 * Signs administrator A in, answers the real API client at the transport layer and renders
 * the list. Raw fetch is stubbed so a page bypassing the shared client would show up.
 */
async function setup(kind: Kind, { list, mutate = async () => ({}), categories = async () => [] }: Setup = {}) {
  localStorage.setItem('admin_token', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin A' }));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const adapter: AxiosAdapter = async config => {
    const authorization = config.headers.get('Authorization');
    let data;
    if (config.url === '/products/categories') data = await categories();
    else if (config.method === 'get') {
      const params = (config.params || {}) as Params;
      requests.push({ path: config.url, ...params, authorization });
      if (list) data = await list(params, authorization);
      else {
        const rows = Array.from({ length: 40 }, (_, index) => row(kind, index + 1));
        data = result(kind, rows.slice((Number(params.page) - 1) * 20, Number(params.page) * 20), 40);
      }
    } else {
      mutations.push({ path: config.url, method: config.method, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, authorization });
      data = await mutate();
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const Page = pages[kind];
  const commits: HTMLElement[] = [];
  const page = () => <CommitLog commits={commits}><Page /></CommitLog>;
  const view = render(page());
  await settle();
  return { view, commits, fetch, rerender: () => act(() => view.rerender(page())) };
}

/** Administrator B signs in from another tab. */
function changeSession() {
  localStorage.setItem('admin_token', 'admin-b');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Admin B' }));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_token', storageArea: localStorage })); });
}

const search = () => screen.getByRole<HTMLInputElement>('textbox', { name: /^搜索(商品|用户)$/ });
const statusFilter = () => screen.getByRole('combobox', { name: /^(商品|用户)状态$/ });
const button = (name: string) => screen.getAllByRole<HTMLButtonElement>('button', { name })[0];
const checkboxes = () => screen.getAllByRole<HTMLInputElement>('checkbox');

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await settle();
}

async function type(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
  await settle();
}

beforeEach(() => {
  requests = [];
  mutations = [];
  notifications.length = 0;
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe.each(['products', 'users'] as const)('admin %s list', (kind) => {
  it('keeps the current filter rows when an older response arrives late', async () => {
    const old = deferred();
    const { fetch } = await setup(kind, { list: params => params.keyword ? result(kind, [row(kind, 2, 'New filter')]) : old.promise });

    await type(search(), 'new');
    expect(screen.getByText('New filter')).toBeInTheDocument();
    await act(async () => old.resolve(result(kind, [row(kind, 1, 'Old filter')])));
    await settle();

    expect(screen.getByText('New filter')).toBeInTheDocument();
    expect(screen.queryByText('Old filter')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(requests.at(-1)?.authorization).toBe('Bearer admin-a');
  });

  it('returns to the first page when the filters change', async () => {
    await setup(kind);

    await click(button('下一页'));
    expect(requests.at(-1)?.page).toBe(2);
    await type(search(), 'Row 1');
    expect(requests.at(-1)?.page).toBe(1);
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    await type(statusFilter(), '0');
    expect(requests.at(-1)?.page).toBe(1);
  });

  it('shows a retry after failures and never presents a failed refresh as old or empty results', async () => {
    let calls = 0;
    await setup(kind, { list: async () => {
      if (++calls !== 2) throw apiError('获取用户列表失败');
      return result(kind, [row(kind, 1, 'Loaded row')]);
    } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    await click(button('重新加载'));
    expect(screen.getByText('Loaded row')).toBeInTheDocument();

    await click(button('搜索'));
    expect(screen.queryByText('Loaded row')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('hides rows at once and resets page and filters when another administrator signs in', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const replacement = deferred();
    const { view, commits } = await setup(kind, { list: (_, auth) => auth === 'Bearer admin-b' ? replacement.promise : result(kind, [row(kind, 1, 'Admin A data')], 40) });
    await type(search(), 'Admin A');
    await click(button('下一页'));

    const before = commits.length;
    changeSession();
    const firstRender = commits[before];
    expect(firstRender.textContent).not.toContain('Admin A data');
    expect(firstRender.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('');
    await settle();
    expect(requests.at(-1)?.page).toBe(1);
    expect(requests.at(-1)?.keyword).toBeUndefined();

    await act(async () => replacement.resolve(result(kind, [row(kind, 2, 'Admin B data')])));
    await settle();
    expect(screen.getByText('Admin B data')).toBeInTheDocument();
    expect(screen.queryByText('Admin A data')).not.toBeInTheDocument();

    view.unmount();
    const storageListeners = (spy: typeof added) => spy.mock.calls.filter(([name]) => name === 'storage').map(([, listener]) => listener);
    expect(storageListeners(removed)).toEqual(expect.arrayContaining(storageListeners(added)));
  });

  it('deduplicates status submissions and disables competing mutations until the refresh finishes', async () => {
    const write = deferred();
    const { fetch } = await setup(kind, { mutate: () => write.promise });
    const action = button(statusAction[kind]);

    act(() => { action.click(); action.click(); });
    await settle();
    expect(mutations).toHaveLength(1);
    expect(button(statusAction[kind])).toBeDisabled();
    if (kind === 'products') expect(button('添加商品')).toBeDisabled();

    await act(async () => write.resolve({}));
    await settle();
    expect(requests).toHaveLength(2);
    expect(notifications).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(button(statusAction[kind])).toBeEnabled();
  });

  it('clamps pagination and reloads the remaining rows after disabling the last item on the final page', async () => {
    let total = 21;
    await setup(kind, {
      list: params => {
        const rows = Array.from({ length: total }, (_, index) => row(kind, index + 1));
        return result(kind, rows.slice((params.page - 1) * 20, params.page * 20), total);
      },
      mutate: async () => { total = 20; },
    });
    await type(statusFilter(), '1');
    await click(button('下一页'));
    expect(screen.getByText('Row 21')).toBeInTheDocument();

    await click(button(statusAction[kind]));

    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    expect(screen.getByText('Row 20')).toBeInTheDocument();
    expect(screen.queryByText('Row 21')).not.toBeInTheDocument();
    expect(requests.at(-1)).toMatchObject({ page: 1, status: '1' });
  });

  it.each(['success', 'failure'] as const)('cannot let a late list %s replace the new administrator rows or error state', async (outcome) => {
    const old = deferred();
    await setup(kind, { list: (_, auth) => auth === 'Bearer admin-a' ? old.promise : result(kind, [row(kind, 2, 'Replacement rows')]) });
    changeSession();
    await settle();
    expect(screen.getByText('Replacement rows')).toBeInTheDocument();

    await act(async () => {
      if (outcome === 'success') old.resolve(result(kind, [row(kind, 1, 'Stale rows')]));
      else old.reject(apiError('旧身份错误'));
    });
    await settle();

    expect(screen.getByText('Replacement rows')).toBeInTheDocument();
    expect(screen.queryByText('Stale rows')).not.toBeInTheDocument();
    expect(notifications).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an old row action once another tab replaces the token, before and after the next render', async () => {
    const { rerender } = await setup(kind);
    const old = captureHandler(button(statusAction[kind]));
    localStorage.setItem('admin_token', 'admin-b');

    await old();
    expect(mutations).toHaveLength(0);
    rerender();
    await old();
    expect(mutations).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  const lateMutationCases = (['account', 'unmount'] as const).flatMap(replacement =>
    (['success', 'failure'] as const).map(outcome => ({ replacement, outcome })));

  it.each(lateMutationCases)('neither notifies nor refreshes on a late mutation $outcome after an $replacement change', async ({ replacement, outcome }) => {
    const write = deferred();
    const { view } = await setup(kind, { mutate: () => write.promise });
    fireEvent.click(button(statusAction[kind]));
    await settle();

    if (replacement === 'account') {
      changeSession();
      await settle();
    } else view.unmount();
    const requestCount = requests.length;
    await act(async () => {
      if (outcome === 'success') write.resolve({});
      else write.reject(apiError('旧操作失败'));
    });
    await settle();

    expect(requests).toHaveLength(requestCount);
    expect(notifications).toHaveLength(0);
  });

  it('refreshes the current page when a mutation finishes after a page change, and keeps old row handlers inactive', async () => {
    const write = deferred();
    await setup(kind, { mutate: () => write.promise });
    const old = captureHandler(button(statusAction[kind]));

    const operation = old();
    await settle();
    await click(button('下一页'));
    expect(screen.getByText('Row 21')).toBeInTheDocument();
    await old();
    expect(mutations).toHaveLength(1);

    await act(async () => write.resolve({}));
    await operation;
    await settle();
    expect(screen.getByText('Row 21')).toBeInTheDocument();
    expect(requests.at(-1)?.page).toBe(2);
    expect(notifications).toHaveLength(0);
  });

  it('invalidates row actions as soon as the list scope changes, before React commits the new query', async () => {
    await setup(kind);
    const action = button(statusAction[kind]);

    act(() => {
      fireEvent.change(search(), { target: { value: 'new query' } });
      action.click();
    });
    expect(mutations).toHaveLength(0);

    await settle();
    expect(requests.at(-1)?.keyword).toBe('new query');
  });
});

describe('admin product selection and creation', () => {
  async function fillAddForm() {
    await click(button('添加商品'));
    fireEvent.change(screen.getByPlaceholderText('请输入商品标题'), { target: { value: 'New product' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText(/^分类/), { target: { value: '1' } });
    await settle();
  }
  const createButton = () => screen.getAllByRole('button', { name: '添加商品' }).at(-1)!;

  it('ties the selection to the displayed page and filter', async () => {
    await setup('products');

    await click(checkboxes()[0]);
    expect(screen.getByText('已选择 20 个商品')).toBeInTheDocument();
    const staleToggle = captureHandler(checkboxes()[1], 'onChange');

    await click(button('下一页'));
    expect(checkboxes()[0]).not.toBeChecked();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();

    await staleToggle();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();

    await click(button('上一页'));
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
    await click(checkboxes()[1]);
    expect(screen.getByText('已选择 1 个商品')).toBeInTheDocument();

    await type(search(), 'changed');
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
  });

  it('makes creation exclusive with duplicate creates, row status changes and batch submissions', async () => {
    const write = deferred();
    const { fetch } = await setup('products', { mutate: () => write.promise, categories: async () => [{ category_id: 1, name: 'Category' }] });
    await click(checkboxes()[1]);
    await fillAddForm();

    act(() => {
      const create = createButton();
      create.click();
      create.click();
      button('下架').click();
      button('批量下架').click();
    });
    await settle();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].method).toBe('post');
    expect(mutations[0].body).toMatchObject({ title: 'New product', price: 12.5 });

    await act(async () => write.resolve({ product_id: 41 }));
    await settle();
    expect(notifications).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '添加商品' })).not.toBeInTheDocument();
  });

  it("hides the previous administrator's create draft and ignores its old form handlers", async () => {
    const { commits } = await setup('products', { categories: async () => [{ category_id: 1, name: 'Category' }] });
    await fillAddForm();
    // Read the old handlers now: React clears them from nodes it unmounts.
    const oldTitleHandler = reactHandler(screen.getByPlaceholderText('请输入商品标题'), 'onChange');
    const oldTitleChange = (value: string) => act(() => { oldTitleHandler({ target: { value } }); });
    const oldCreate = captureHandler(createButton());

    const before = commits.length;
    changeSession();
    expect(commits[before].querySelector('[placeholder="请输入商品标题"]')).toBeNull();
    await settle();
    await click(button('添加商品'));
    expect(screen.getByPlaceholderText('请输入商品标题')).toHaveValue('');

    oldTitleChange('Old handler edit');
    await oldCreate();
    await settle();
    expect(screen.getByPlaceholderText('请输入商品标题')).toHaveValue('');
    expect(mutations).toHaveLength(0);
  });
});
