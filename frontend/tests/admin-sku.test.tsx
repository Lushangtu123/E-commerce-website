import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import SkuPage from '@/app/admin/products/[id]/skus/page';
import api, { type AdminSKU } from '@/lib/api';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { apiError, captureHandler, deferred, reactHandler, render, settle } from './helpers';

/**
 * The administrator sign-in a request went out for. The httpOnly cookie names it to the API, so a
 * request that still carried a token header would show up here as that header instead.
 */
const sentSession = (config: { headers: { get(name: string): unknown } }) =>
  config.headers.get('Authorization') ?? `session:${localStorage.getItem('admin_session')}`;


const params = vi.hoisted(() => ({ id: '1' }));
// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => params, useRouter: () => router, usePathname: () => '/admin/products' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

type Request = { url?: string; method?: string; body?: Record<string, unknown>; authorization: unknown };
type Mutate = (url: string | undefined, body: Record<string, unknown>) => Promise<unknown>;

const product = { product_id: 1, title: '原始中文商品', status: 1 };
const sku: AdminSKU = { sku_id: 11, product_id: 1, sku_code: 'BLUE-M', specs: { Color: 'Blue', Size: 'M' }, price: '12.50', stock: 2, original_price: null, image: null, status: 1 };
const originalAdapter = api.defaults.adapter;
let requests: Request[] = [];

interface Setup {
  list?: (config: InternalAxiosRequestConfig) => unknown;
  mutate?: Mutate;
  locale?: Locale;
  page?: () => ReactNode;
  /** Runs after the sessions are stored and before the first render. */
  before?: () => void;
}

/**
 * Signs administrator one in beside a customer session, answers the real API client at the
 * transport layer and renders the SKU manager for the product in `params.id`.
 */
async function setup({ list = async () => ({ product, skus: [sku] }), mutate = async () => ({ sku_id: 12 }), locale = 'zh-CN', page = () => <SkuPage />, before }: Setup = {}) {
  localStorage.setItem('session', 'customer-session');
  localStorage.setItem('admin_session', 'admin-one');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: '测试管理员' }));
  useLocaleStore.getState().setLocale(locale);
  const adapter: AxiosAdapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ url: config.url, method: config.method, body, authorization: sentSession(config) });
    const data = config.method === 'get' ? await list(config) : await mutate(config.url, body);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  before?.();
  const view = render(page());
  await settle();
  return { view, rerender: () => act(() => view.rerender(page())) };
}

function changeSession() {
  localStorage.setItem('admin_session', 'admin-two');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: '另一个管理员' }));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session', storageArea: localStorage })); });
}

const field = (name: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
const form = () => document.querySelector('form');
const button = (name: string | RegExp) => screen.queryAllByRole<HTMLButtonElement>('button', { name })[0];

/**
 * Types into the editor. A select only offers its options, so a value it lacks (a tampered
 * status) goes straight to the React handler, which must still validate it.
 */
async function edit(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const element = field(name)!;
    if (element instanceof HTMLSelectElement && !Array.from(element.options).some(option => option.value === value)) {
      act(() => { reactHandler(element, 'onChange')({ target: { value } }); });
    } else fireEvent.change(element, { target: { value } });
  }
  await settle();
}

async function click(name: string | RegExp) {
  fireEvent.click(button(name)!);
  await settle();
}

async function submit() {
  fireEvent.submit(form()!);
  await settle();
}

beforeEach(() => {
  requests = [];
  params.id = '1';
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('admin SKU management', () => {
  it('is linked from each product in the admin product list', async () => {
    await setup({ page: () => <AdminProductsPage />,
      list: async config => config.url === '/products/categories' ? [] : { products: [{ ...product, price: 10, stock: 3 }], pagination: { total: 1 } } });

    expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/admin/products/1/skus')).toHaveLength(1);
  });

  it('loads disabled variants, the parent identity and the active price and stock summary with admin credentials', async () => {
    await setup({ list: async () => ({ product, skus: [sku, { ...sku, sku_id: 12, sku_code: 'DISABLED', price: '1.00', stock: 99, status: 0 }] }) });

    expect(screen.getByText(/原始中文商品/)).toBeInTheDocument();
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    expect(screen.getByText('可售库存：2')).toBeInTheDocument();
    expect(screen.getByText('最低售价：¥12.50')).toBeInTheDocument();
    expect(requests[0].url).toBe('/admin/products/1/skus');
    expect(requests[0].authorization).toBe('session:admin-one');
  });

  it('creates a SKU with normalized zero price and stock, then reloads the server list with admin credentials only', async () => {
    let created: AdminSKU | undefined;
    await setup({
      list: async () => ({ product, skus: created ? [sku, created] : [sku] }),
      mutate: async (_url, body) => { created = { ...(body as unknown as AdminSKU), product_id: 1, sku_id: 12 }; return { sku_id: 12 }; },
    });

    await click('新增规格');
    await edit({ sku_code: '  FREE-M  ', price: '0', stock: '0', 'spec-name-0': '  Color  ', 'spec-value-0': '  Green  ' });
    await submit();

    expect(requests[1]).toEqual({ method: 'post', url: '/admin/products/1/skus', authorization: 'session:admin-one',
      body: { sku_code: 'FREE-M', specs: { Color: 'Green' }, price: 0, original_price: null, stock: 0, image: null, status: 1 } });
    expect(requests.filter(request => request.method === 'get')).toHaveLength(2);
    expect(screen.getByText('FREE-M')).toBeInTheDocument();
    expect(form()).toBeNull();
    expect(screen.getByText('规格已保存')).toBeInTheDocument();
    expect(localStorage.getItem('session')).toBe('customer-session');
  });

  it('binds product and SKU IDs when editing, keeps typed spec values and clears optional fields', async () => {
    let current: AdminSKU = { ...sku, specs: { Size: 42, Waterproof: false }, original_price: '20.00', image: '/old.jpg' };
    await setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return { message: '更新成功' }; } });

    await click('编辑规格');
    expect(field('spec-value-0')).toHaveValue('42');
    expect(field('spec-value-1')).toHaveValue('false');
    await edit({ price: '15.25', original_price: '', image: '', stock: '4' });
    await submit();

    expect(requests[1].url).toBe('/admin/products/1/skus/11');
    expect(requests[1].body).toEqual({ price: 15.25, original_price: null, image: null, stock: 4 });
    expect(screen.getByText('最低售价：¥15.25')).toBeInTheDocument();
    expect(screen.getByText('可售库存：4')).toBeInTheDocument();
  });

  it('changes only the status and the summary when a SKU is disabled and enabled', async () => {
    let current: AdminSKU = { ...sku };
    await setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return {}; } });

    await click('停用规格');
    expect(requests[1].body).toEqual({ status: 0 });
    expect(screen.getByText('可售库存：0')).toBeInTheDocument();
    expect(screen.getByText('暂无启用规格')).toBeInTheDocument();

    await click('启用规格');
    expect(requests[3].body).toEqual({ status: 1 });
    expect(screen.getByText('可售库存：2')).toBeInTheDocument();
  });

  it('follows the selected language for labels and async errors without translating product or spec values', async () => {
    const pending = deferred();
    await setup({ locale: 'en', mutate: () => pending.promise });
    expect(screen.getByText('SKU management')).toBeInTheDocument();
    expect(screen.getByText(/原始中文商品/)).toBeInTheDocument();

    await click('Edit variant');
    await edit({ price: '13' });
    fireEvent.submit(form()!);
    act(() => useLocaleStore.getState().setLocale('zh-CN'));
    await act(async () => pending.reject(apiError('SKU编码已存在')));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('SKU编码已存在');
    expect(field('price')).toHaveValue('13');
  });

  it('cannot replace an unsaved draft with another variant through a saved edit handler', async () => {
    await setup({ list: async () => ({ product, skus: [sku, { ...sku, sku_id: 12, sku_code: 'OTHER' }] }) });
    const [first, second] = screen.getAllByRole('button', { name: '编辑规格' }).map(editor => captureHandler(editor));

    await act(() => first());
    await edit({ price: '19' });
    await act(() => second());

    expect(field('sku_code')).toHaveValue('BLUE-M');
    expect(field('price')).toHaveValue('19');
  });

  it('keeps invalid fields from the API and accepts the monetary and inventory boundaries', async () => {
    await setup();
    await click('编辑规格');
    const values = { sku_code: 'BLUE-M', price: '12.50', stock: '2', original_price: '', image: '', status: '1', 'spec-name-0': 'Color', 'spec-value-0': 'Blue' };
    for (const [name, value, message] of [
      ['sku_code', '_bad', '规格编码须为'], ['sku_code', 'A'.repeat(51), '规格编码须为'],
      ['price', '-1', '金额须为'], ['price', '1.001', '金额须为'], ['price', '1e2', '金额须为'], ['price', '100000000', '金额须为'],
      ['stock', '1.5', '库存须为'], ['stock', '2147483648', '库存须为'], ['stock', '-1', '库存须为'],
      ['original_price', '1.001', '金额须为'], ['image', 'a'.repeat(256), '图片地址最多'], ['status', '2', '规格状态无效'],
      ['spec-name-0', ' ', '请填写1至20项规格'], ['spec-value-0', 'a'.repeat(101), '请填写1至20项规格'],
    ]) {
      await edit({ ...values, [name]: value });
      await submit();
      expect(screen.getByRole('alert'), `${name}: ${value}`).toHaveTextContent(message);
      expect(requests).toHaveLength(1);
    }

    await edit({ ...values, price: '99999999.99', original_price: '0', stock: '2147483647' });
    await submit();
    expect(requests[1].body).toMatchObject({ price: 99999999.99, stock: 2147483647 });
  });

  it('adds and removes attribute rows, rejects duplicate names and stops at twenty', async () => {
    await setup();
    await click('编辑规格');

    await edit({ 'spec-name-1': ' Color ' });
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('规格名称不能重复');
    expect(requests).toHaveLength(1);

    await click(/^移除规格属性/);
    expect(field('spec-name-0')).toHaveValue(' Color ');
    await click(/^移除规格属性/);
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('请填写1至20项规格');

    for (let count = 0; count < 20; count++) await click('添加规格属性');
    expect(document.querySelectorAll('input[name^="spec-name-"]')).toHaveLength(20);
    expect(button('添加规格属性')).toBeDisabled();
  });

  it('keeps the draft after a failed save for a retry, and old handlers can neither submit twice nor toggle meanwhile', async () => {
    const pending = deferred();
    let attempt = 0;
    await setup({ mutate: () => ++attempt === 1 ? pending.promise : Promise.resolve({}) });
    const toggle = captureHandler(button('停用规格')!);
    await click('编辑规格');
    await edit({ price: '19' });
    const savedSubmit = captureHandler(form()!, 'onSubmit');

    void savedSubmit();
    await savedSubmit();
    await toggle();
    await settle();
    expect(requests).toHaveLength(2);
    expect(button('保存中...')).toBeDisabled();

    await act(async () => pending.reject(apiError('权限不足')));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('权限不足');
    expect(field('price')).toHaveValue('19');

    await submit();
    expect(attempt).toBe(2);
    expect(screen.getByText('规格已保存')).toBeInTheDocument();
  });

  it('closes the form after a create whose list refresh fails, and the retry only reloads', async () => {
    let reads = 0;
    await setup({ list: async () => {
      if (++reads === 2) throw new Error('offline');
      return { product, skus: [sku] };
    } });

    await click('新增规格');
    await edit({ sku_code: 'NEW', price: '5', 'spec-name-0': 'Color', 'spec-value-0': 'Red' });
    await submit();
    expect(screen.getByText(/规格已保存，但列表刷新失败/)).toBeInTheDocument();
    expect(form()).toBeNull();

    await click('重新加载');
    expect(requests.filter(request => request.method === 'post')).toHaveLength(1);
    expect(screen.getByText('BLUE-M')).toBeInTheDocument();
  });

  it.each(['id', 'missing-token', 'malformed-user'] as const)('neither requests nor exposes an editor for an invalid %s', async (scenario) => {
    await setup({ before: () => {
      if (scenario === 'id') params.id = '1e2';
      if (scenario === 'missing-token') localStorage.removeItem('admin_session');
      if (scenario === 'malformed-user') localStorage.setItem('admin_user', '{}');
    } });

    expect(requests).toHaveLength(0);
    expect(button('新增规格')).toBeUndefined();
  });

  const lateCases = (['product', 'account', 'storage', 'unmount'] as const).flatMap(scenario =>
    ([false, true] as const).map(fail => ({ scenario, fail })));

  it.each(lateCases)('ignores a late read (fails=$fail) after a $scenario change', async ({ scenario, fail }) => {
    const pending = deferred();
    let reads = 0;
    const { view, rerender } = await setup({ list: async () => ++reads === 1 ? pending.promise
      : { product: { ...product, product_id: Number(params.id), title: '新页面商品' }, skus: [] } });

    if (scenario === 'product') params.id = '2';
    if (scenario === 'account') changeSession();
    if (scenario === 'storage') localStorage.setItem('admin_session', 'raw-other');
    if (scenario === 'unmount') view.unmount();
    else {
      rerender();
      await settle();
    }
    await act(async () => {
      if (fail) pending.reject(apiError('旧错误'));
      else pending.resolve({ product, skus: [sku] });
    });
    await settle();

    expect(screen.queryByText(/原始中文商品/)).not.toBeInTheDocument();
    expect(screen.queryByText('旧错误')).not.toBeInTheDocument();
    // The stored token is read on every render, so even an unannounced change loads the new session's list.
    expect(requests).toHaveLength(scenario === 'unmount' ? 1 : 2);
    if (scenario === 'storage') expect(requests[1].authorization).toBe('session:raw-other');
  });

  it.each(lateCases)('neither refreshes nor reports a late mutation (fails=$fail) after a $scenario change', async ({ scenario, fail }) => {
    const pending = deferred();
    const { view, rerender } = await setup({ mutate: () => pending.promise,
      list: async () => ({ product: { ...product, product_id: Number(params.id) }, skus: Number(params.id) === 1 ? [sku] : [] }) });
    const oldToggle = captureHandler(button('停用规格')!);

    const saving = oldToggle();
    if (scenario === 'product') params.id = '2';
    if (scenario === 'account') changeSession();
    if (scenario === 'storage') localStorage.setItem('admin_session', 'raw-other');
    if (scenario === 'unmount') view.unmount();
    else {
      rerender();
      await settle();
    }
    await oldToggle();
    const before = requests.length;
    await act(async () => {
      if (fail) pending.reject(apiError('旧保存错误'));
      else pending.resolve({});
    });
    await saving;
    await settle();

    expect(requests).toHaveLength(before);
    expect(screen.queryByText('规格已停用')).not.toBeInTheDocument();
    expect(screen.queryByText('旧保存错误')).not.toBeInTheDocument();
  });

  it.each([
    ['another product', { product: { ...product, product_id: 2 }, skus: [sku] }],
    ["another product's SKU", { product, skus: [{ ...sku, product_id: 2 }] }],
    ['a missing price', { product, skus: [{ ...sku, price: null }] }],
    ['nested spec values', { product, skus: [{ ...sku, specs: { Color: { nested: 'unsafe' } } }] }],
  ])('fails closed on a response with %s and allows a reload', async (_, broken) => {
    let reads = 0;
    await setup({ list: async () => ++reads === 1 ? broken : { product, skus: [sku] } });
    expect(screen.getByRole('alert')).toHaveTextContent('获取SKU列表失败');
    expect(button('编辑规格')).toBeUndefined();

    await click('重新加载');
    expect(button('编辑规格')).toBeDefined();
  });

  it('warns that enabling variants alone does not make an inactive product purchasable', async () => {
    await setup({ locale: 'en', list: async () => ({ product: { ...product, status: 0 }, skus: [sku] }) });
    expect(screen.getByText('This product is unavailable. Activate the product to allow purchases.')).toBeInTheDocument();
  });

  it.each(['SKU不存在', 'SKU不属于该商品', 'SKU字段或值无效', '商品不存在', '商品或SKU ID、字段或值无效'])('shows the API failure "%s" readably in English and keeps the draft', async (error) => {
    await setup({ locale: 'en', mutate: async () => { throw apiError(error); } });
    await click('Edit variant');
    await edit({ price: '13' });
    await submit();

    expect(screen.getByRole('alert').textContent).not.toMatch(/[㐀-鿿]/);
    expect(field('sku_code')).toHaveValue('BLUE-M');
  });

  it('omits stock from a price-only edit so a purchase made while editing is not overwritten', async () => {
    let current: AdminSKU = { ...sku };
    await setup({ list: async () => ({ product, skus: [current] }), mutate: async (_url, body) => { current = { ...current, ...body }; return {}; } });
    await click('编辑规格');
    current = { ...current, stock: 1 }; // A buyer purchases one unit while the editor is open.

    await edit({ price: '13' });
    await submit();

    expect(requests[1].body).toEqual({ price: 13 });
    expect(screen.getByText('可售库存：1')).toBeInTheDocument();
  });

  it('keeps untouched numeric and boolean attributes and submits only specs when attributes change', async () => {
    await setup({ list: async () => ({ product, skus: [{ ...sku, specs: { Size: 42, Waterproof: false } }] }) });
    await click('编辑规格');
    await click('添加规格属性');

    await edit({ 'spec-name-2': 'Color', 'spec-value-2': 'Blue' });
    await submit();

    expect(requests[1].body).toEqual({ specs: { Size: 42, Waterproof: false, Color: 'Blue' } });
  });

  it('writes nothing, and so creates no audit event, when an unchanged edit is saved', async () => {
    await setup();
    await click('编辑规格');

    await submit();

    expect(requests).toHaveLength(1);
    expect(screen.getByText('没有需要保存的修改')).toBeInTheDocument();
  });

  it('lets the next administrator open the editor and act at once, even while the previous one was editing or saving', async () => {
    const pending = deferred();
    let writes = 0;
    const { rerender } = await setup({ mutate: () => ++writes === 1 ? pending.promise : Promise.resolve({}) });
    const oldToggle = captureHandler(button('停用规格')!);
    void oldToggle();
    await settle();

    changeSession();
    rerender();
    await settle();
    await click('停用规格');
    expect(requests.filter(request => request.method === 'put').map(request => request.authorization)).toEqual(['session:admin-one', 'session:admin-two']);

    await click('编辑规格');
    expect(form()).not.toBeNull();
  });

  it('closes an open editor when the administrator changes and lets the next one open their own', async () => {
    const { rerender } = await setup();
    await click('编辑规格');
    expect(form()).not.toBeNull();

    changeSession();
    rerender();
    await settle();
    expect(form()).toBeNull();
    expect(button('新增规格')).toBeEnabled();
    await click('新增规格');
    expect(form()).not.toBeNull();
  });

  it("forgets a product's notice and save state when the page returns to it", async () => {
    let reads = 0;
    const { rerender } = await setup({ list: async () => {
      reads++;
      if (reads === 2 || reads === 4) throw new Error('offline');
      return { product: { ...product, product_id: Number(params.id) }, skus: Number(params.id) === 1 ? [sku] : [] };
    } });
    await click('停用规格');
    expect(screen.getByText(/规格已保存，但列表刷新失败/)).toBeInTheDocument();
    expect(screen.getByText('规格已停用')).toBeInTheDocument();

    params.id = '2';
    rerender();
    await settle();
    params.id = '1';
    rerender();
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('获取SKU列表失败');
    expect(screen.queryByText(/规格已保存/)).not.toBeInTheDocument();
    expect(screen.queryByText('规格已停用')).not.toBeInTheDocument();
  });

  it('reports a failed retry after a save as an ordinary load failure', async () => {
    let reads = 0;
    await setup({ list: async () => {
      if (++reads >= 2) throw new Error('offline');
      return { product, skus: [sku] };
    } });
    await click('停用规格');
    expect(screen.getByText(/规格已保存，但列表刷新失败/)).toBeInTheDocument();

    await click('重新加载');
    expect(screen.getByRole('alert')).toHaveTextContent('获取SKU列表失败');
    expect(screen.queryByText(/规格已保存，但列表刷新失败/)).not.toBeInTheDocument();
  });

  it('sends no reload for the administrator another tab replaced, before the storage event arrives', async () => {
    await setup({ list: async () => { throw new Error('offline'); } });
    localStorage.setItem('admin_session', 'raw-other');

    fireEvent.click(button('重新加载')!);
    await settle();
    // The API client would send a stale reload with the new token, so the only safe outcome is no request.
    expect(requests).toHaveLength(1);
  });

  it('keeps edit, toggle and cancel handlers from an older list or a pending save inactive', async () => {
    let disabled = false;
    const pending = deferred();
    let writes = 0;
    const { rerender } = await setup({
      list: async () => ({ product: { ...product, product_id: Number(params.id) }, skus: Number(params.id) === 1 ? [{ ...sku, status: disabled ? 0 : 1 }] : [] }),
      mutate: async () => { if (++writes === 2) return pending.promise; disabled = true; return {}; },
    });
    const staleToggle = captureHandler(button('停用规格')!);
    await click('停用规格');
    expect(screen.getByText('已停用')).toBeInTheDocument();
    await staleToggle();
    await settle();
    expect(writes).toBe(1);

    await click('编辑规格');
    await edit({ price: '19' });
    const cancel = captureHandler(button('取消')!);
    void captureHandler(form()!, 'onSubmit')();
    await settle();
    await cancel();
    expect(form()).not.toBeNull();
    await act(async () => pending.resolve({}));
    await settle();

    const staleEdit = captureHandler(button('编辑规格')!);
    params.id = '2';
    rerender();
    await settle();
    await staleEdit();
    expect(form()).toBeNull();
    // A hidden editor from the old list would otherwise block the new product's own forms.
    expect(button('新增规格')).toBeEnabled();
  });
});
