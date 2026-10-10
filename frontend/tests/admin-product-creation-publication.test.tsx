import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductsPage from '@/app/admin/products/page';
import api from '@/lib/api';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT } from '@/lib/admin-session';
import { deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/products' }));
vi.mock('react-hot-toast', () => ({ default: toast }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
const receipt = { key: '01234567-89ab-4cde-8abc-0123456789ab', input: { title: 'Original product', price: 2, stock: 5, category_id: 1 } };

function signIn(id = 'a') {
  localStorage.setItem('admin_session', id);
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: id === 'a' ? 1 : 2, username: id }));
}
function publication(pending: boolean) {
  act(() => {
    if (pending) localStorage.setItem(ADMIN_CLEANUP_KEY, '1'); else localStorage.removeItem(ADMIN_CLEANUP_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_CLEANUP_KEY, storageArea: localStorage }));
    window.dispatchEvent(new Event(ADMIN_SESSION_EVENT));
  });
}
function serve(save: (body: Record<string, unknown>) => Promise<unknown> = async () => ({ product_id: 99 })) {
  const writes: Record<string, unknown>[] = [];
  api.defaults.adapter = async config => {
    let data;
    if (config.method === 'post') {
      const body = JSON.parse(config.data); writes.push(body); data = await save(body);
    } else data = config.url === '/products/categories' ? [{ category_id: 1, name: 'Category' }] : { products: [], pagination: { total: 0 } };
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  return writes;
}

it.each([false, true])('restores the exact pending receipt without auto-posting (mounted during publication=%s)', async paused => {
  signIn(); sessionStorage.setItem('pending-product-create:a', JSON.stringify(receipt));
  const writes = serve();
  if (paused) publication(true);
  render(<ProductsPage />); await settle();
  if (paused) {
    expect(screen.queryByRole('button', { name: '添加商品' })).toBeNull();
    publication(false); await settle();
  }
  expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试确认商品' })).toBeEnabled();
  expect(writes).toEqual([]);
  expect(JSON.parse(sessionStorage.getItem('pending-product-create:a')!)).toEqual(receipt);
  fireEvent.click(screen.getByRole('button', { name: '重试确认商品' })); await settle();
  expect(writes).toEqual([{ ...receipt.input, create_key: receipt.key }]);
  expect(sessionStorage.getItem('pending-product-create:a')).toBeNull();
  expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
});

it('allows a new creation only after reading empty storage for the resumed session', async () => {
  signIn(); const writes = serve(); publication(true);
  render(<ProductsPage />); await settle();
  expect(screen.queryByRole('button', { name: '添加商品' })).toBeNull();
  publication(false); await settle();
  expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重试确认商品' })).toBeNull();
  expect(writes).toEqual([]);
});

it('keeps unreadable receipts blocked after publication until an explicit safe reread', async () => {
  signIn(); sessionStorage.setItem('pending-product-create:a', '{broken');
  const writes = serve(); publication(true); render(<ProductsPage />); await settle();
  publication(false); await settle();
  expect(screen.getByRole('button', { name: '添加商品' })).toBeDisabled();
  expect(screen.getByText('无法读取商品新增记录，请检查浏览器存储后重试')).toBeInTheDocument();
  sessionStorage.removeItem('pending-product-create:a');
  fireEvent.click(screen.getByRole('button', { name: '重新读取新增记录' })); await settle();
  expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
  expect(writes).toEqual([]);
});

it('does not restore the old administrator receipt after replacement during publication', async () => {
  signIn(); sessionStorage.setItem('pending-product-create:a', JSON.stringify(receipt));
  const writes = serve(); publication(true); render(<ProductsPage />); await settle();
  signIn('b'); publication(false); await settle();
  expect(screen.queryByRole('button', { name: '重试确认商品' })).toBeNull();
  expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
  expect(JSON.parse(sessionStorage.getItem('pending-product-create:a')!)).toEqual(receipt);
  expect(writes).toEqual([]);
});

it('preserves the owner of an in-flight creation while the same session pauses and resumes', async () => {
  signIn(); const response = deferred<unknown>(); const writes = serve(() => response.promise);
  render(<ProductsPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '添加商品' })); await settle();
  for (const [field, value] of Object.entries({ title: 'Original product', price: '2', 'category-id': '1', stock: '5' })) {
    fireEvent.change(document.getElementById(`newProduct-${field}`)!, { target: { value } });
  }
  fireEvent.click(screen.getAllByRole('button', { name: '添加商品' }).at(-1)!); await settle();
  expect(writes).toHaveLength(1);
  const stored = sessionStorage.getItem('pending-product-create:a');
  publication(true); response.resolve({ product_id: 99 }); await settle();
  expect(sessionStorage.getItem('pending-product-create:a')).toBe(stored);
  publication(false); await settle();
  expect(writes).toHaveLength(1);
  expect(sessionStorage.getItem('pending-product-create:a')).toBeNull();
  expect(toast.success).toHaveBeenCalledWith('商品添加成功');
  expect(screen.getByRole('button', { name: '添加商品' })).toBeEnabled();
});
