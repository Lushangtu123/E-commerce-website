import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SKUPage from '@/app/admin/products/[id]/skus/page';
import api from '@/lib/api';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT } from '@/lib/admin-session';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '1' }), useRouter: () => router, usePathname: () => '/admin/products/1/skus' }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });

function publication(pending: boolean) {
  act(() => {
    if (pending) localStorage.setItem(ADMIN_CLEANUP_KEY, '1'); else localStorage.removeItem(ADMIN_CLEANUP_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_CLEANUP_KEY, storageArea: localStorage }));
    window.dispatchEvent(new Event(ADMIN_SESSION_EVENT));
  });
}

it.each(['english', 'stock', 'unchanged'] as const)('diffs the %s edit against the opened SKU after a same-session refresh', async edit => {
  localStorage.setItem('admin_session', 'a');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin A' }));
  let stock = 2;
  const writes: Record<string, unknown>[] = [];
  api.defaults.adapter = async config => {
    let data;
    if (config.method === 'put') {
      const body = JSON.parse(config.data); writes.push(body);
      if ('stock' in body) stock = body.stock;
      data = { message: '更新成功' };
    } else data = {
      product: { product_id: 1, title: '商品', status: 1 },
      skus: [{ sku_id: 11, product_id: 1, sku_code: 'BLUE', specs: { Color: 'Blue' }, specs_en: null, price: '12.50', stock, original_price: null, image: null, status: 1 }],
    };
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  render(<SKUPage />); await settle();
  fireEvent.click(screen.getByRole('button', { name: '编辑规格' })); await settle();
  if (edit === 'english') fireEvent.change(document.querySelector('input[name="spec-nameEn-0"]')!, { target: { value: 'Color' } });
  if (edit === 'stock') fireEvent.change(document.querySelector('input[name="stock"]')!, { target: { value: '5' } });
  publication(true); await settle();
  stock = 1; // A buyer consumes stock while a login temporarily pauses this administrator.
  publication(false); await settle();
  expect(screen.getByText('可售库存：1')).toBeInTheDocument();
  expect(document.querySelector('input[name="stock"]')).toHaveValue(edit === 'stock' ? '5' : '2');
  fireEvent.submit(document.querySelector('form')!); await settle();
  if (edit === 'unchanged') {
    expect(writes).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('没有需要保存的修改');
  } else expect(writes).toEqual([edit === 'english' ? { specs_en: { Color: { name: 'Color' } } } : { stock: 5 }]);
  expect(stock).toBe(edit === 'stock' ? 5 : 1);
});
