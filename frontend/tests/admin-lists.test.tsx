import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import AdminUsersPage from '@/app/admin/users/page';
import api from '@/lib/api';
import { logger } from '@/lib/logger';
import { CommitLog, apiError, captureHandler, deferred, reactHandler, render, settle } from './helpers';

/**
 * The administrator sign-in a request went out for. The httpOnly cookie names it to the API, so a
 * request that still carried a token header would show up here as that header instead.
 */
const sentSession = (config: { headers: { get(name: string): unknown } }) =>
  config.headers.get('Authorization') ?? `session:${localStorage.getItem('admin_session')}`;


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
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin A' }));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const adapter: AxiosAdapter = async config => {
    const authorization = sentSession(config);
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
  localStorage.setItem('admin_session', 'admin-b');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Admin B' }));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session', storageArea: localStorage })); });
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

async function searchFor(value: string) {
  await type(search(), value);
  await click(button('搜索'));
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

    await searchFor('new');
    expect(screen.getByText('New filter')).toBeInTheDocument();
    await act(async () => old.resolve(result(kind, [row(kind, 1, 'Old filter')])));
    await settle();

    expect(screen.getByText('New filter')).toBeInTheDocument();
    expect(screen.queryByText('Old filter')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(requests.at(-1)?.authorization).toBe('session:admin-a');
  });

  it('returns to the first page when the filters change', async () => {
    await setup(kind);

    await click(button('下一页'));
    expect(requests.at(-1)?.page).toBe(2);
    await searchFor('Row 1');
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
    expect(logger.error).toHaveBeenCalledTimes(1);

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
    const { view, commits } = await setup(kind, { list: (_, auth) => auth === 'session:admin-b' ? replacement.promise : result(kind, [row(kind, 1, 'Admin A data')], 40) });
    await searchFor('Admin A');
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
    const { commits } = await setup(kind, {
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
    const emptyTables = commits.filter(commit => commit.querySelector('table') && !/Row \d+/.test(commit.textContent ?? ''));
    expect(emptyTables, 'the emptied page must not flash').toEqual([]);
  });

  it.each(['success', 'failure'] as const)('cannot let a late list %s replace the new administrator rows or error state', async (outcome) => {
    const old = deferred();
    await setup(kind, { list: (_, auth) => auth === 'session:admin-a' ? old.promise : result(kind, [row(kind, 2, 'Replacement rows')]) });
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
    localStorage.setItem('admin_session', 'admin-b');

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
    await type(search(), 'new query');

    act(() => {
      fireEvent.submit(search().closest('form')!);
      action.click();
    });
    await settle();
    expect(mutations).toHaveLength(0);
    expect(requests.at(-1)?.keyword).toBe('new query');

    // Clearing filters by click rather than through the controlled input does not re-render first.
    act(() => {
      button('重置').click();
      button(statusAction[kind]).click();
    });
    await settle();
    expect(mutations).toHaveLength(0);
    expect(requests.at(-1)?.keyword).toBeUndefined();

    const next = button('下一页');
    act(() => {
      next.click();
      button(statusAction[kind]).click();
    });
    await settle();
    expect(mutations).toHaveLength(0);
    expect(requests.at(-1)?.page).toBe(2);
  });

  it('keeps a row handler rendered before a refresh inactive once the refresh changes its rows', async () => {
    let changed = false;
    await setup(kind, {
      list: () => result(kind, [row(kind, 1, changed ? 'Changed row' : 'Row 1'), row(kind, 2)]),
      mutate: async () => { changed = true; },
    });
    const stale = captureHandler(screen.getAllByRole('button', { name: statusAction[kind] })[1]);

    await click(button(statusAction[kind]));
    expect(mutations).toHaveLength(1);
    expect(requests).toHaveLength(2);

    await stale();
    await settle();
    expect(mutations).toHaveLength(1);
  });

  it('lets the next administrator act while the previous administrator\'s change is pending', async () => {
    const write = deferred();
    let writes = 0;
    await setup(kind, { mutate: () => ++writes === 1 ? write.promise : Promise.resolve({}) });
    fireEvent.click(button(statusAction[kind]));
    await settle();

    changeSession();
    await settle();
    await click(button(statusAction[kind]));
    expect(mutations.map(item => item.authorization)).toEqual(['session:admin-a', 'session:admin-b']);
  });

  it('ignores stale filter and pagination handlers once the list has moved on', async () => {
    await setup(kind, { list: params => result(kind, [row(kind, params.page, `Page ${params.page}`)], 60) });
    const staleStatus = reactHandler(statusFilter(), 'onChange');
    await searchFor('kept');
    act(() => { staleStatus({ target: { value: '0' } }); });
    await settle();
    expect(requests.at(-1)).toMatchObject({ keyword: 'kept' });
    expect(requests.at(-1)?.status).toBeUndefined();

    await click(button('下一页'));
    const stalePrevious = captureHandler(button('上一页'));
    await click(button('下一页'));
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    await stalePrevious();
    await settle();
    expect(requests.at(-1)?.page).toBe(3);
    expect(screen.getByText('Page 3')).toBeInTheDocument();
  });

  it('sends no reload for the administrator another tab replaced, before the storage event arrives', async () => {
    await setup(kind);
    localStorage.setItem('admin_session', 'admin-b');
    const count = requests.length;

    fireEvent.click(button('搜索'));
    await settle();
    // The API client would send a stale reload with the new token, so the only safe outcome is no request.
    expect(requests).toHaveLength(count);
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

    await searchFor('changed');
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
    expect(createButton()).toBeDisabled();
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

  const field = (label: RegExp) => screen.getByLabelText<HTMLInputElement>(label);
  const productFields = [/^商品标题/, /^商品描述/, /^价格/, /^库存/, /^分类/, /^品牌/, /^商品图片URL/, /^状态/];

  it('requires a title, price and category, then creates the product from every field and resets the form', async () => {
    await setup('products', { mutate: async () => ({ product_id: 41 }), categories: async () => [{ category_id: 1, name: 'Category' }, { category_id: 2, name: 'Other' }] });
    await click(button('添加商品'));
    expect(screen.getByRole('heading', { name: '添加商品' })).toBeInTheDocument();
    await click(createButton());
    await type(field(/^商品标题/), 'Lamp');
    await type(field(/^价格/), '19.90');
    await click(createButton());
    expect(notifications).toEqual(['请填写商品标题、价格和分类', '请填写商品标题、价格和分类']);
    expect(mutations).toEqual([]);

    const values = ['Lamp', 'Warm light', '19.90', '7', '2', 'Acme', 'https://example.test/lamp.jpg', '0'];
    for (let index = 0; index < productFields.length; index++) await type(field(productFields[index]), values[index]);
    expect(screen.getByRole('img', { name: '预览' })).toHaveAttribute('src', 'https://example.test/lamp.jpg');
    await click(createButton());

    expect(mutations).toEqual([expect.objectContaining({ method: 'post', path: '/admin/products', body: {
      title: 'Lamp', description: 'Warm light', price: 19.9, stock: 7, category_id: 2, brand: 'Acme',
      image_url: 'https://example.test/lamp.jpg', status: 0,
      create_key: expect.stringMatching(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),
    } })]);
    expect(notifications.at(-1)).toBe('商品添加成功');
    expect(screen.queryByRole('heading', { name: '添加商品' })).not.toBeInTheDocument();
    await click(button('添加商品'));
    expect(productFields.map(label => field(label).value)).toEqual(['', '', '', '', '', '', '', '1']);
  });

  it('opens a row in the edit form, saves the changed fields and closes', async () => {
    await setup('products', { categories: async () => [{ category_id: 1, name: 'Category' }, { category_id: 2, name: 'Other' }] });
    await click(button('编辑'));
    expect(screen.getByRole('heading', { name: '编辑商品' })).toBeInTheDocument();
    expect(productFields.map(label => field(label).value)).toEqual(['Row 1', '', '10.00', '5', '1', '', '', '1']);

    await type(field(/^价格/), '');
    await click(button('保存修改'));
    expect(notifications).toEqual(['请填写商品标题、价格和分类']);
    expect(mutations).toEqual([]);

    await type(field(/^价格/), '15');
    await type(field(/^库存/), 'many');
    await type(field(/^分类/), '2');
    await type(field(/^状态/), '0');
    await click(button('保存修改'));
    expect(mutations).toEqual([]);
    expect(notifications.at(-1)).toBe('库存须为0至2147483647的整数');
    await type(field(/^库存/), '0');
    await click(button('保存修改'));
    expect(mutations).toEqual([expect.objectContaining({ method: 'put', path: '/admin/products/1', body: {
      price: 15, stock: 0, category_id: 2, status: 0,
    } })]);
    expect(notifications.at(-1)).toBe('商品更新成功');
    expect(screen.queryByRole('heading', { name: '编辑商品' })).not.toBeInTheDocument();
  });

  it.each(['添加商品', '编辑'])('closes the %s form from its cancel button without sending anything', async (open) => {
    await setup('products');
    await click(button(open));
    await type(field(/^商品标题/), 'Draft');
    await click(button('取消'));

    expect(screen.queryByRole('heading', { name: /^(添加|编辑)商品$/ })).not.toBeInTheDocument();
    expect(mutations).toEqual([]);
  });

  it('logs a category failure without blocking the list', async () => {
    await setup('products', { categories: async () => { throw apiError('分类不可用'); } });
    expect(screen.getAllByText(/^Row \d+$/)).toHaveLength(20);
    expect(vi.mocked(logger.error).mock.calls.map(([message]) => message)).toEqual(['获取分类失败:']);
  });

  it('recovers failed categories without losing the create draft or duplicating retries', async () => {
    const replacement = deferred();
    let categoryCalls = 0;
    await setup('products', { categories: async () => {
      if (++categoryCalls === 1) throw apiError('分类不可用');
      return replacement.promise;
    } });
    await click(button('添加商品'));
    expect(screen.getByRole('alert')).toHaveTextContent('获取分类失败，请重新加载');
    expect(field(/^分类/)).toBeDisabled();
    expect(createButton()).toBeDisabled();
    await type(field(/^商品标题/), 'Draft lamp');
    await type(field(/^价格/), '19.90');
    const retry = button('重新加载分类');
    const retryHandler = captureHandler(retry);
    act(() => { retry.click(); retry.click(); });
    await settle();
    await retryHandler();
    await settle();
    expect(categoryCalls).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载分类...');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(field(/^商品标题/)).toHaveValue('Draft lamp');
    expect(field(/^价格/)).toHaveValue(19.9);

    await act(async () => replacement.resolve([{ category_id: 1, name: 'Lighting' }]));
    await settle();
    expect(field(/^分类/)).toBeEnabled();
    expect(createButton()).toBeEnabled();
    expect(field(/^商品标题/)).toHaveValue('Draft lamp');
    await type(field(/^分类/), '1');
    await click(createButton());
    expect(mutations).toEqual([expect.objectContaining({ body: expect.objectContaining({ title: 'Draft lamp', price: 19.9, category_id: 1 }) })]);
  });

  it('shows categories loading while letting an administrator prepare a draft', async () => {
    const categories = deferred();
    await setup('products', { categories: () => categories.promise });
    expect(screen.getAllByText(/^Row \d+$/)).toHaveLength(20);
    await click(button('添加商品'));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载分类...');
    expect(field(/^分类/)).toBeDisabled();
    expect(createButton()).toBeDisabled();
    await type(field(/^商品标题/), 'Prepared while loading');
    await act(async () => categories.resolve([{ category_id: 1, name: 'Category' }]));
    await settle();
    expect(field(/^商品标题/)).toHaveValue('Prepared while loading');
    expect(field(/^分类/)).toBeEnabled();
  });

  it('keeps the existing edit category visible while its choices are unavailable', async () => {
    await setup('products', { categories: async () => { throw apiError('分类不可用'); } });
    await click(button('编辑'));
    expect(field(/^分类/)).toHaveValue('1');
    expect(screen.getByRole('option', { name: '当前分类（ID：1）' })).toHaveValue('1');
    expect(field(/^分类/)).toBeDisabled();
    expect(button('保存修改')).toBeDisabled();
    expect(field(/^商品标题/)).toHaveValue('Row 1');
  });

  it('discards old category retries and their responses when the administrator changes', async () => {
    const oldRetry = deferred();
    let categoryCalls = 0;
    await setup('products', { categories: async () => {
      categoryCalls += 1;
      if (categoryCalls === 1) throw apiError('分类不可用');
      if (categoryCalls === 2) return oldRetry.promise;
      return [{ category_id: 2, name: 'New administrator category' }];
    } });
    await click(button('添加商品'));
    await type(field(/^商品标题/), 'Private draft');
    const oldHandler = captureHandler(button('重新加载分类'));
    void oldHandler();
    await settle();
    changeSession();
    await settle();
    expect(screen.queryByPlaceholderText('请输入商品标题')).not.toBeInTheDocument();
    await click(button('添加商品'));
    expect(field(/^商品标题/)).toHaveValue('');
    expect(screen.getByRole('option', { name: 'New administrator category' })).toBeInTheDocument();
    await oldHandler();
    await act(async () => oldRetry.resolve([{ category_id: 1, name: 'Old administrator category' }]));
    await settle();
    expect(categoryCalls).toBe(3);
    expect(screen.queryByRole('option', { name: 'Old administrator category' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'New administrator category' })).toBeInTheDocument();
    expect(mutations).toEqual([]);
  });

  it('keeps selection and forms still while a change is pending', async () => {
    const write = deferred();
    await setup('products', { mutate: () => write.promise });
    const toggleRow = captureHandler(checkboxes()[1], 'onChange');
    const toggleAll = captureHandler(checkboxes()[0], 'onChange');
    const openAdd = captureHandler(button('添加商品'));
    const openEdit = captureHandler(button('编辑'));
    fireEvent.click(button('下架'));
    await settle();

    await toggleRow();
    await toggleAll();
    await openAdd();
    await openEdit();
    await settle();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^(添加|编辑)商品$/ })).not.toBeInTheDocument();
  });

  it('ignores a create handler from a form whose list scope has moved on', async () => {
    await setup('products');
    await click(button('添加商品'));
    const staleCreate = captureHandler(createButton());
    await searchFor('changed');

    await staleCreate();
    await settle();
    expect(notifications).toEqual([]);
    expect(mutations).toEqual([]);
  });

  it("does not follow a row's specification link for the administrator another tab replaced", async () => {
    await setup('products');
    localStorage.setItem('admin_session', 'admin-b');

    const followed = fireEvent.click(screen.getAllByRole('link', { name: '管理规格' })[0]);
    expect(followed, 'navigation must be cancelled').toBe(false);
  });
});
