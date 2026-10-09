import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => ({ errors: [] as string[], successes: [] as string[] }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (value: string) => notifications.errors.push(value), success: (value: string) => notifications.successes.push(value) };
  return { default: toast, toast };
});
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; notifications.errors.length = 0; notifications.successes.length = 0; });
const firstUser = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const secondUser = { user_id: 2, username: 'Other', email: 'other@example.test' };
const product = (id = 11) => ({ product_id: id, favorite_id: id, id, title: `Product ${id}`, price: '10.00', stock: 3, status: 1, has_sku: false, browsed_at: '2026-10-09T00:00:00Z' });
type Kind = 'favorites' | 'history';
type Row = ReturnType<typeof product>;
const pageOf = (kind: Kind, rows: Row[], page: number) => ({ [kind]: rows.slice((page - 1) * 20, page * 20), pagination: { total: rows.length, total_pages: Math.ceil(rows.length / 20) } });
const failed = (status?: number) => status === undefined ? new AxiosError('Lost response', 'ERR_NETWORK')
  : Object.assign(new Error('Write rejected'), { response: { status, data: { message: status === 404 ? '记录不存在' : '拒绝删除测试' } } });

async function prepare(kind: Kind, { status, applied = true, success = false, rows = [product()], read, write, detailFails = false }: {
  status?: number; applied?: boolean; success?: boolean; rows?: Row[];
  read?: (value: ReturnType<typeof pageOf>, config: InternalAxiosRequestConfig) => Promise<unknown>;
  write?: () => Promise<void>; detailFails?: boolean;
} = {}) {
  useAuthStore.getState().login(firstUser, 'buyer-one'); vi.stubGlobal('confirm', () => true);
  let canonical = [...rows], gets = 0, writes = 0, details = 0;
  const pages: number[] = [];
  api.defaults.adapter = async config => {
    let data: unknown;
    if (config.method === 'get' && config.url === '/products/11') { details++; if (detailFails) throw failed(); data = { product: product() }; }
    else if (config.method === 'get') {
      gets++; const page = Number(config.params?.page) || 1; pages.push(page);
      const value = pageOf(kind, useAuthStore.getState().user?.user_id === 2 ? [product(99)] : canonical, page);
      data = gets > 1 && read ? await read(value, config) : value;
    } else {
      writes++; if (write) await write();
      if (applied) canonical = config.url === '/browse/history' ? [] : canonical.filter(row => row.product_id !== Number(config.url!.split('/').at(-1)));
      if (!success) throw failed(status); data = { message: '删除成功' };
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const view = render(kind === 'favorites' ? <FavoritesPage /> : <HistoryPage />); await settle();
  const remove = () => document.querySelector<HTMLButtonElement>(`button[title="${kind === 'favorites' ? '取消收藏' : '删除记录'}"]`)!;
  return { view, remove, counts: () => ({ gets, writes, details }), pages };
}
const retry = () => screen.getByRole('button', { name: '重新核对列表' });
const checking = '删除结果未知，正在核对最新列表...';
const unconfirmed = '删除结果尚未确认，请重新核对列表后再操作';

describe.each(['favorites', 'history'] as const)('%s deletion reconciliation', kind => {
  it('refreshes after an acknowledged successful deletion', async () => {
    const f = await prepare(kind, { success: true }); fireEvent.click(f.remove()); await settle();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
    expect(screen.queryByRole('heading', { name: 'Product 11' })).not.toBeInTheDocument();
    expect(notifications.successes).toHaveLength(1);
  });
  it.each([undefined, 408, 429, 500, 404])('uses one read and no repeat write to reconcile status %s', async status => {
    const f = await prepare(kind, { status }); fireEvent.click(f.remove()); await settle();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
    expect(screen.queryByRole('heading', { name: 'Product 11' })).not.toBeInTheDocument();
    expect(notifications.successes).toEqual([]);
  });
  it('keeps an uncommitted deletion removable after checking, without claiming it succeeded', async () => {
    const f = await prepare(kind, { applied: false }); fireEvent.click(f.remove()); await settle();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 }); expect(f.remove()).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Product 11' })).toBeInTheDocument();
    expect(notifications.successes).toEqual([]);
  });
  it('keeps a deterministic 400 refusal editable without a read or success message', async () => {
    const f = await prepare(kind, { status: 400, applied: false }); fireEvent.click(f.remove()); await settle();
    expect(f.counts()).toMatchObject({ gets: 1, writes: 1 }); expect(f.remove()).toBeEnabled();
    expect(notifications.errors).toEqual(['拒绝删除测试']); expect(notifications.successes).toEqual([]);
  });
  it('offers a read-only retry when checking fails and refuses the old removal handler', async () => {
    let available = false;
    const f = await prepare(kind, { read: async value => { if (!available) throw failed(); return value; } });
    const staleRemove = captureHandler(f.remove()); fireEvent.click(f.remove()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmed); expect(retry()).toBeEnabled();
    await staleRemove(); await settle(); expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
    available = true; fireEvent.click(retry()); await settle();
    expect(f.counts()).toMatchObject({ gets: 3, writes: 1 });
    expect(screen.queryByRole('heading', { name: 'Product 11' })).not.toBeInTheDocument();
    expect(screen.queryByText(unconfirmed)).not.toBeInTheDocument();
  });
  it('does not accept a malformed checking response as an empty collection', async () => {
    const f = await prepare(kind, { read: async () => ({}) }); fireEvent.click(f.remove()); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmed); expect(retry()).toBeEnabled();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
  });
  it('blocks more mutations while the authoritative read is pending', async () => {
    const pending = deferred<unknown>();
    const f = await prepare(kind, { read: () => pending.promise }); const staleRemove = captureHandler(f.remove());
    fireEvent.click(f.remove()); await settle(); expect(screen.getByRole('status')).toHaveTextContent(checking);
    expect(f.remove()).toBeDisabled(); await staleRemove(); await settle(); expect(f.counts().writes).toBe(1);
    await act(async () => pending.resolve(pageOf(kind, [], 1))); await settle();
  });
  it.each(['account', 'storage', 'unmount'] as const)('ignores an old checking result after %s changes', async change => {
    const pending = deferred<unknown>(); let reads = 0;
    const f = await prepare(kind, { read: value => ++reads === 1 ? pending.promise : Promise.resolve(value) });
    fireEvent.click(f.remove()); await settle();
    expect(f.counts().gets).toBe(2);
    if (change === 'account') act(() => useAuthStore.getState().login(secondUser, 'buyer-two'));
    if (change === 'storage') localStorage.setItem('session', 'buyer-two');
    if (change === 'unmount') f.view.unmount();
    await settle(); await act(async () => pending.resolve(pageOf(kind, [], 1))); await settle();
    expect(screen.queryByText(unconfirmed)).not.toBeInTheDocument(); expect(notifications.successes).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Product 11' })).not.toBeInTheDocument();
    if (change === 'account') { expect(screen.getByRole('heading', { name: 'Product 99' })).toBeInTheDocument(); expect(f.remove()).toBeEnabled(); }
  });
  it('reconciles the page now displayed when a pending deletion finishes after pagination', async () => {
    const pending = deferred<void>();
    const f = await prepare(kind, { rows: Array.from({ length: 21 }, (_, index) => product(index + 1)), write: () => pending.promise });
    fireEvent.click(f.remove()); await settle(); fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    await act(async () => pending.resolve()); await settle(10);
    expect(f.counts().writes).toBe(1); expect(f.pages).toEqual([1, 2, 2, 1]);
    expect(screen.queryByRole('heading', { name: 'Product 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Product 21' })).toBeInTheDocument();
  });
  it('retires a pre-delete page read so its late reply cannot restore the old count', async () => {
    const write = deferred<void>(), oldRead = deferred<unknown>(); let reads = 0;
    const original = Array.from({ length: 21 }, (_, index) => product(index + 1));
    const f = await prepare(kind, { rows: original, write: () => write.promise,
      read: value => ++reads === 1 ? oldRead.promise : Promise.resolve(value) });
    fireEvent.click(f.remove()); await settle(); fireEvent.click(screen.getByRole('button', { name: '下一页' })); await settle();
    await act(async () => write.resolve()); await settle(10);
    expect(f.pages).toEqual([1, 2, 2, 1]); expect(f.counts().writes).toBe(1);
    await act(async () => oldRead.resolve(pageOf(kind, original, 2))); await settle();
    expect(screen.getByRole('heading', { name: 'Product 21' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Product 1' })).not.toBeInTheDocument();
    expect(screen.getByText(kind === 'favorites' ? '共 20 个商品' : '最近浏览了 20 个商品')).toBeInTheDocument();
    expect(f.counts().writes).toBe(1);
  });
  it('does not apply deletion recovery to a failed quick cart action', async () => {
    const f = await prepare(kind, { detailFails: true }); fireEvent.click(screen.getByRole('button', { name: '加入购物车' })); await settle();
    expect(f.counts()).toEqual({ gets: 1, writes: 0, details: 1 });
    expect(screen.queryByText(checking)).not.toBeInTheDocument(); expect(screen.queryByText(unconfirmed)).not.toBeInTheDocument();
    expect(f.remove()).toBeEnabled();
  });
});

describe('history clearing reconciliation', () => {
  it('reads after a lost clear reply without clearing again', async () => {
    const f = await prepare('history'); fireEvent.click(screen.getByRole('button', { name: '清空历史' })); await settle();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
    expect(screen.getByText('暂无浏览记录')).toBeInTheDocument(); expect(notifications.successes).toEqual([]);
  });
  it('offers a read-only retry when the clear result cannot be checked', async () => {
    let available = false;
    const f = await prepare('history', { read: async value => { if (!available) throw failed(); return value; } });
    const clear = captureHandler(screen.getByRole('button', { name: '清空历史' }));
    fireEvent.click(screen.getByRole('button', { name: '清空历史' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(unconfirmed); await clear(); await settle();
    expect(f.counts()).toMatchObject({ gets: 2, writes: 1 });
    available = true; fireEvent.click(retry()); await settle();
    expect(f.counts()).toMatchObject({ gets: 3, writes: 1 }); expect(screen.getByText('暂无浏览记录')).toBeInTheDocument();
  });
  it('translates the failed-check notice and retry action into English', async () => {
    await prepare('history', { read: async () => { throw failed(); } });
    fireEvent.click(screen.getByRole('button', { name: '清空历史' })); await settle();
    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getByRole('alert')).toHaveTextContent('The deletion result is unconfirmed. Check the list again before continuing.');
    expect(screen.getByRole('button', { name: 'Check list again' })).toBeEnabled();
  });
});
