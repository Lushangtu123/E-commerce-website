import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import { EMPTY_PRODUCT_FORM, toProductPayload } from '@/components/AdminProductForm';
import api, { type AdminProductRow } from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, reactHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/products' }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: notifications }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const originalAdapter = api.defaults.adapter;
const product: AdminProductRow = {
  product_id: 1, title: '中文商品', title_en: 'English product', description: '中文描述', description_en: 'English description',
  specs: { 颜色: '红色', 尺寸: 42, 防水: false, 详情: { 材料: '棉' } },
  specs_en: { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' } },
  price: '10.00', stock: 5, category_id: 1, sales_count: 0, rating: 0, status: 1,
};
type Write = { url?: string; body: Record<string, unknown> };

async function setup(source = product) {
  notifications.error.mockClear(); notifications.success.mockClear();
  localStorage.setItem('admin_session', 'admin-one');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  useLocaleStore.getState().setLocale('en');
  const writes: Write[] = [];
  let current = source;
  const adapter: AxiosAdapter = async config => {
    let data: unknown;
    if (config.method === 'get') data = config.url === '/products/categories'
      ? [{ category_id: 1, name: 'Category' }] : { products: [current], pagination: { total: 1 } };
    else {
      const body = JSON.parse(config.data) as Record<string, unknown>;
      writes.push({ url: config.url, body }); current = { ...current, ...body }; data = {};
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<AdminProductsPage />);
  await settle();
  return { writes, view, purchase: () => { current = { ...current, stock: 4 }; } };
}

const input = (id: string) => document.getElementById(`editProduct-${id}`) as HTMLInputElement;
async function change(id: string, value: string) { fireEvent.change(input(id), { target: { value } }); await settle(); }
async function edit() { fireEvent.click(screen.getByRole('button', { name: 'Edit' })); await settle(); }
async function save() { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await settle(); }
afterEach(() => { api.defaults.adapter = originalAdapter; });

describe('admin product bilingual content', () => {
  it('disables English values for typed attributes and removes obsolete values while retaining their English names', async () => {
    const { writes } = await setup({ ...product, specs_en: {
      颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size', value: 'Forty-two' },
      防水: { name: 'Waterproof', value: 'No' }, 详情: { name: 'Details', value: 'Cotton details' },
    } });
    await edit();
    expect(input('spec-value-en-0')).toBeEnabled();
    for (const index of [1, 2, 3]) {
      expect(input(`spec-name-en-${index}`)).toBeEnabled();
      expect(input(`spec-value-en-${index}`)).toBeDisabled();
      expect(input(`spec-value-en-${index}`)).toHaveValue('');
    }
    expect(screen.getAllByText('Numbers and boolean values keep their original values.')).toHaveLength(3);
    await save();
    expect(writes).toEqual([{ url: '/admin/products/1', body: { specs_en: {
      颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' }, 防水: { name: 'Waterproof' }, 详情: { name: 'Details' },
    } } }]);
  });

  it('opens an uncategorized legacy product and saves its selected category without rewriting other fields', async () => {
    const { writes } = await setup({ ...product, category_id: null } as unknown as AdminProductRow);
    await captureHandler(screen.getByRole('button', { name: 'Edit' }))();
    await settle();
    expect(input('title')).toHaveValue('中文商品');
    expect(input('category-id')).toHaveValue('');
    await save();
    expect(writes).toHaveLength(0);
    expect(notifications.error).toHaveBeenCalled();
    await change('category-id', '1');
    await save();
    expect(writes).toEqual([{ url: '/admin/products/1', body: { category_id: 1 } }]);
  });

  it('displays the English title but opens the Chinese source and both existing English text fields', async () => {
    await setup();
    expect(screen.getByText('English product')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select English product' })).toBeInTheDocument();
    await edit();
    expect(input('title')).toHaveValue('中文商品');
    expect(input('description')).toHaveValue('中文描述');
    expect(input('title-en')).toHaveValue('English product');
    expect(input('description-en')).toHaveValue('English description');
    expect(input('spec-name-en-0')).toHaveValue('Color');
    expect(input('spec-value-en-0')).toHaveValue('Red');
  });

  it('saves only trimmed English changes and leaves stock, price and typed source specs untouched', async () => {
    const { writes, purchase } = await setup();
    await edit(); purchase();
    await change('title-en', '  New name  ');
    await change('description-en', '  New description  ');
    await change('spec-name-en-2', '  Waterproof  ');
    await save();
    expect(writes).toEqual([{ url: '/admin/products/1', body: {
      title_en: 'New name', description_en: 'New description',
      specs_en: { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' }, 防水: { name: 'Waterproof' } },
    } }]);
    expect(screen.getByText('4', { selector: 'td' })).toBeInTheDocument();
  });

  it('clears existing English content with null without resubmitting the Chinese source', async () => {
    const { writes } = await setup();
    await edit();
    await change('title-en', ' '); await change('description-en', '');
    await change('spec-name-en-0', ''); await change('spec-value-en-0', ''); await change('spec-name-en-1', '');
    await save();
    expect(writes[0].body).toEqual({ title_en: null, description_en: null, specs_en: null });
    expect(screen.getByText('中文商品')).toBeInTheDocument();
  });

  it('creates optional English text while preserving the Chinese source', async () => {
    const { writes } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add product' })); await settle();
    for (const [field, value] of Object.entries({ title: '新中文', 'title-en': '  New product  ', description: '新描述', 'description-en': '  New description  ', price: '2', 'category-id': '1' })) {
      fireEvent.change(document.getElementById(`newProduct-${field}`)!, { target: { value } }); await settle();
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Add product' }).at(-1)!); await settle();
    expect(writes[0]).toMatchObject({ url: '/admin/products', body: { title: '新中文', description: '新描述', title_en: 'New product', description_en: 'New description' } });
  });

  it('rejects overlong English names with an English error before sending a write', async () => {
    const { writes } = await setup();
    await edit();
    act(() => reactHandler(input('title-en'), 'onChange')({ target: { value: 'a'.repeat(201) } }));
    await save();
    expect(writes).toHaveLength(0);
    expect(notifications.error).toHaveBeenLastCalledWith('English product titles may contain up to 200 characters.');
    await change('title-en', 'English product');
    act(() => reactHandler(input('spec-name-en-0'), 'onChange')({ target: { value: 'a'.repeat(51) } }));
    await save();
    expect(writes).toHaveLength(0);
    expect(notifications.error).toHaveBeenLastCalledWith('English attribute names may contain up to 50 characters and values up to 100 characters.');
  });

  it('keeps old English input handlers inactive after another administrator opens a fresh form', async () => {
    const { view, writes } = await setup();
    await edit();
    const oldChange = reactHandler(input('title-en'), 'onChange');
    const oldSave = captureHandler(screen.getByRole('button', { name: 'Save changes' }));
    localStorage.setItem('admin_session', 'admin-two');
    localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Next' }));
    act(() => view.rerender(<AdminProductsPage />)); await settle();
    await edit();
    act(() => oldChange({ target: { value: 'Stale English' } })); await oldSave(); await settle();
    expect(input('title-en')).toHaveValue('English product');
    expect(writes).toHaveLength(0);
  });

  it.each([{ specs: ['数组'] }, { specs: '原始文本' }, { specs: 42 }, { specs: false }, { specs: null }])('never serializes untouched source specs $specs into the update body', ({ specs }) => {
    const payload = toProductPayload({ ...EMPTY_PRODUCT_FORM, title: '商品', price: '1', category_id: '1', specs, title_en: 'Title' });
    expect(payload).not.toHaveProperty('specs');
    expect(payload).toMatchObject({ title: '商品', title_en: 'Title' });
  });
});
