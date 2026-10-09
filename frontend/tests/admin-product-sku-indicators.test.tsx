import { act, fireEvent, screen, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';
import api from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/products' }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
const product = { product_id: 2, title: '规格商品', title_en: 'Variant product', price: '100.00', stock: 99,
  category_id: 1, status: 1, has_sku: 1, sellable_stock: 7, sku_min_price: '12.50' };
async function setup(row = product) {
  localStorage.setItem('admin_session', 'admin-one');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  const writes: Record<string, unknown>[] = [];
  const adapter: AxiosAdapter = async config => {
    const data = config.method === 'get' ? config.url === '/products/categories' ? [{ category_id: 1, name: '分类' }]
      : { products: [row], pagination: { total: 1 } } : (writes.push(JSON.parse(config.data)), { message: '更新成功' });
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter; render(<AdminProductsPage />); await settle(); return writes;
}
afterEach(() => { api.defaults.adapter = originalAdapter; });
describe('administrator variant product indicators', () => {
  it('shows variant inventory and starting price alongside clearly labelled base fields', async () => {
    await setup(); const row = screen.getByRole('row', { name: /规格商品/ });
    expect(within(row).getByText('规格起价 ¥12.50')).toBeInTheDocument();
    expect(within(row).getByText('可售库存 7')).toBeInTheDocument();
    expect(within(row).getByText('基础价格 ¥100.00')).toBeInTheDocument();
    expect(within(row).getByText('基础库存 99')).toBeInTheDocument();
  });
  it('does not advertise the base price when every variant is disabled', async () => {
    await setup({ ...product, sellable_stock: 0, sku_min_price: null as unknown as string });
    expect(screen.getByText('无启用规格')).toBeInTheDocument();
    expect(screen.getByText('可售库存 0')).toBeInTheDocument();
  });
  it('keeps variant base inventory read-only and links to variant management while allowing content edits', async () => {
    const writes = await setup(); fireEvent.click(screen.getByRole('button', { name: '编辑' })); await settle();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^基础价格 \(元\)/)).toBeDisabled();
    expect(within(dialog).getByLabelText('基础库存')).toBeDisabled();
    expect(within(dialog).getByRole('link', { name: '管理规格' })).toHaveAttribute('href', '/admin/products/2/skus');
    fireEvent.change(within(dialog).getByLabelText(/^商品标题/), { target: { value: '更新标题' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' })); await settle();
    expect(writes).toEqual([{ title: '更新标题' }]);
  });
  it('translates the variant indicators and base form labels into English', async () => {
    await setup(); act(() => useLocaleStore.getState().setLocale('en')); await settle();
    expect(screen.getByText('Variant price from ¥12.50')).toBeInTheDocument();
    expect(screen.getByText('Sellable stock 7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' })); await settle();
    expect(screen.getByLabelText(/^Base price \(CNY\)/)).toBeDisabled();
    expect(screen.getByLabelText('Base stock')).toBeDisabled();
  });
});
