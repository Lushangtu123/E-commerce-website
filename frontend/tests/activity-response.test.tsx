import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });

it.each(['favorites', 'history'] as const)('%s rejects a missing collection and recovers through one read-only retry', async kind => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'activity-response-session');
  const methods: string[] = [];
  api.defaults.adapter = async config => {
    methods.push(config.method!);
    return { config, status: 200, statusText: 'OK', headers: {}, data: methods.length === 1 ? {}
      : { [kind]: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } } };
  };
  render(kind === 'favorites' ? <FavoritesPage /> : <HistoryPage />); await settle();
  const empty = kind === 'favorites' ? '暂无收藏商品' : '暂无浏览记录';
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText(empty)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
  expect(screen.getByText(empty)).toBeInTheDocument();
  expect(methods).toEqual(['get', 'get']);
});

const row = { favorite_id: 1, id: 1, product_id: 1, title: 'Current product', price: '1.00', stock: '3', status: 1, browsed_at: '2026-10-10T00:00:00Z' };
const pagination = { page: 1, limit: 20, total: 1, total_pages: 1 };
it('favorites keeps a malformed original price out of render and retries without writing', async () => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'activity-response-session');
  const methods: string[] = [];
  api.defaults.adapter = async config => {
    methods.push(config.method!);
    return { config, status: 200, statusText: 'OK', headers: {}, data: { favorites: [methods.length === 1
      ? { ...row, original_price: { toString: null, valueOf: null } } : { ...row, original_price: '2.00' }], pagination } };
  };
  render(<FavoritesPage />); await settle();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await settle();
  expect(screen.getByRole('heading', { name: 'Current product' })).toBeInTheDocument();
  expect(methods).toEqual(['get', 'get']);
});
for (const kind of ['favorites', 'history'] as const) {
  const invalid = [
    null, { [kind]: {}, pagination }, { [kind]: [], pagination: null },
    ...[{ ...pagination, total: null }, { ...pagination, total: true }, { ...pagination, total: -1 },
      { ...pagination, page: 2 }, { ...pagination, limit: 50 }, { ...pagination, total_pages: 9 }]
      .map(value => ({ [kind]: [row], pagination: value })),
    ...[null, { ...row, product_id: 0 }, { ...row, user_id: 2 }, { ...row, title: {} }, { ...row, price: true },
      { ...row, stock: false }, { ...row, status: 99 }, { ...row, created_at: 'invalid' }]
      .map(value => ({ [kind]: [value], pagination })),
    { [kind]: [row, row], pagination: { ...pagination, total: 2 } },
  ];
  it.each(invalid.map((value, index) => ({ value, index })))(`${kind} rejects invalid initial snapshot $index with bilingual read-only recovery`, async ({ value }) => {
    useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'activity-response-session');
    const methods: string[] = [];
    api.defaults.adapter = async config => {
      methods.push(config.method!);
      return { config, status: 200, statusText: 'OK', headers: {}, data: methods.length === 1 ? value : { [kind]: [row], pagination } };
    };
    render(kind === 'favorites' ? <FavoritesPage /> : <HistoryPage />); await settle();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入购物车' })).not.toBeInTheDocument();
    act(() => useLocaleStore.getState().setLocale('en'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await settle();
    expect(screen.getByRole('heading', { name: 'Current product' })).toBeInTheDocument();
    expect(methods).toEqual(['get', 'get']);
  });
}

it.each(['favorites', 'history'] as const)('%s retires old row handlers when a same-page refresh returns invalid data', async kind => {
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'activity-response-session');
  let reads = 0, writes = 0;
  const row = { favorite_id: 1, id: 1, product_id: 1, title: 'Old product', price: '1.00', stock: 3, status: 1, browsed_at: '2026-10-10T00:00:00Z' };
  api.defaults.adapter = async config => {
    if (config.method !== 'get') writes++;
    return { config, status: 200, statusText: 'OK', headers: {}, data: config.method === 'get' ? ++reads === 1
      ? { [kind]: [row], pagination: { page: 1, limit: 20, total: 1, total_pages: 1 } } : {} : { message: '删除成功' } };
  };
  render(kind === 'favorites' ? <FavoritesPage /> : <HistoryPage />); await settle();
  const remove = document.querySelector<HTMLButtonElement>(`button[title="${kind === 'favorites' ? '取消收藏' : '删除记录'}"]`)!;
  const staleRemove = captureHandler(remove);
  fireEvent.click(remove); await settle();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await staleRemove(); await settle();
  expect(writes).toBe(1);
  expect(reads).toBe(2);
});
