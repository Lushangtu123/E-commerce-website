import { act, fireEvent, screen, within } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '@/app/admin/products/page';
import api from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { clickTogether, deferred, render, settle } from './helpers';

vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p data-testid="render-error">{this.state.error}</p> : this.props.children; }
}

const originalAdapter = api.defaults.adapter;
const categories = [{ category_id: 1, name: '分类' }];
const product = { product_id: 1, title: '保留商品', price: '12.50', stock: 2, category_id: 1, status: 1 };
afterEach(() => { api.defaults.adapter = originalAdapter; });

async function setup(loadCategories: () => Promise<unknown>) {
  localStorage.setItem('admin_session', 'admin-one');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  const reads: string[] = [], writes: string[] = [];
  const adapter: AxiosAdapter = async config => {
    if (config.method === 'get') reads.push(config.url!); else writes.push(config.url!);
    const data = config.url === '/products/categories' ? await loadCategories()
      : { products: [product], pagination: { total: 1, totalPages: 1 } };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<RenderBoundary><ProductsPage /></RenderBoundary>);
  await settle();
  return { view, reads, writes, categoryReads: () => reads.filter(url => url === '/products/categories') };
}
async function open(mode: 'add' | 'edit') {
  fireEvent.click(screen.getByRole('button', { name: mode === 'add' ? '添加商品' : '编辑' }));
  await settle();
}
const form = () => within(screen.getByRole('dialog'));

describe('administrator product category read safety', () => {
  it.each([
    {}, null, { success: false, error: 'failed' }, [null], [{}], [{ category_id: 0, name: '分类' }],
    [{ category_id: '1', name: '分类' }], [{ category_id: 1, name: {} }],
    [{ category_id: 1, name: ' ' }], [...categories, ...categories],
  ])('rejects malformed HTTP 200 categories %j without losing the list or allowing a write', async malformed => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = await setup(async () => malformed);
    await open('edit');
    expect(screen.queryByTestId('render-error')).not.toBeInTheDocument();
    expect(screen.getByText('保留商品', { selector: 'div' })).toBeInTheDocument();
    expect(form().getByRole('alert')).toHaveTextContent('获取分类失败，请重新加载');
    expect(form().getByRole('button', { name: '保存修改' })).toBeDisabled();
    fireEvent.change(form().getByLabelText(/^商品标题/), { target: { value: '保留编辑草稿' } });
    fireEvent.click(form().getByRole('button', { name: '保存修改' }));
    expect(state.writes).toEqual([]);
    expect(form().getByLabelText(/^商品标题/)).toHaveValue('保留编辑草稿');
  });

  it.each(['add', 'edit'] as const)('retains the %s draft when a pending category read fails, then retries GET only in either language', async mode => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = deferred(), retry = deferred();
    let count = 0;
    const state = await setup(() => ++count === 1 ? first.promise : retry.promise);
    await open(mode);
    fireEvent.change(form().getByLabelText(/^商品标题/), { target: { value: '未提交草稿' } });
    await act(async () => first.resolve({})); await settle();
    expect(screen.queryByTestId('render-error')).not.toBeInTheDocument();
    expect(form().getByLabelText(/^商品标题/)).toHaveValue('未提交草稿');
    expect(form().getByRole('alert')).toHaveTextContent('获取分类失败，请重新加载');
    act(() => useLocaleStore.getState().setLocale('en')); await settle();
    expect(form().getByRole('alert')).toHaveTextContent('Categories could not be loaded. Please reload.');
    const reload = form().getByRole('button', { name: 'Reload categories' });
    clickTogether(reload, reload); await settle();
    expect(state.categoryReads()).toHaveLength(2);
    expect(form().getByLabelText(/Product title/)).toHaveValue('未提交草稿');
    expect(form().getByRole('button', { name: mode === 'add' ? 'Add product' : 'Save changes' })).toBeDisabled();
    await act(async () => retry.resolve(categories)); await settle();
    expect(form().queryByRole('alert')).not.toBeInTheDocument();
    expect(form().getByRole('option', { name: '分类' })).toBeInTheDocument();
    expect(form().getByLabelText(/Product title/)).toHaveValue('未提交草稿');
    expect(form().getByRole('button', { name: mode === 'add' ? 'Add product' : 'Save changes' })).toBeEnabled();
    expect(state.categoryReads()).toHaveLength(2);
    expect(state.reads.filter(url => url === '/admin/products')).toHaveLength(1);
    expect(state.writes).toEqual([]);
  });

  it.each(['add', 'edit'] as const)('accepts a genuine empty category array in the %s form', async mode => {
    const state = await setup(async () => []);
    await open(mode);
    expect(form().queryByRole('alert')).not.toBeInTheDocument();
    expect(form().getByLabelText(/^分类/)).toBeEnabled();
    expect(form().getByRole('button', { name: mode === 'add' ? '添加商品' : '保存修改' })).toBeEnabled();
    expect(state.writes).toEqual([]);
  });
});
