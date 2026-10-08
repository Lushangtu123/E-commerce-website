import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { clickTogether, deferred, render, settle } from './helpers';
const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: navigation.id }), useRouter: () => navigation }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0, review_count: 0 };
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });
beforeEach(() => {
  navigation.id = '1';
  useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
  useAuthStore.setState({ isHydrated: true });
});
function httpError(config: InternalAxiosRequestConfig, status: number, message: string) {
  return new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, config, undefined, { config, status, statusText: 'Failure', headers: {}, data: { message } });
}
function transport({ initial = false, loseWrite = false, commitFirst = true, readFails = false,
  reconciliation = undefined as Promise<{ is_favorited: boolean }> | undefined, alreadyAbsent = false,
  writeStatus = undefined as number | undefined } = {}) {
  let saved = initial, reads = 0, writes = 0;
  const calls: string[] = [];
  api.defaults.adapter = async config => {
    calls.push(`${config.method} ${config.url}`);
    let data: unknown;
    if (/^\/products\/[12]$/.test(config.url!)) data = { product: { ...product, product_id: Number(config.url!.at(-1)) } };
    else if (/^\/reviews\/product\/[12]$/.test(config.url!)) data = { reviews: [], total: 0, totalPages: 0 };
    else if (/^\/recommendations\/related\/[12]$/.test(config.url!)) data = { related_products: [] };
    else if (config.url === '/browse/record') data = {};
    else if (config.url === '/favorites/check/2') data = { is_favorited: false };
    else if (config.url === '/favorites/check/1') {
      reads++;
      if (reads === 2 && readFails) throw httpError(config, 503, '检查收藏状态失败');
      data = reads === 2 && reconciliation ? await reconciliation : { is_favorited: saved };
    } else if (config.url === '/favorites' || config.url === '/favorites/1' || config.url === '/favorites/toggle') {
      writes++;
      if (writeStatus) throw httpError(config, writeStatus, '操作失败');
      if (alreadyAbsent && config.method === 'delete') { saved = false; throw httpError(config, 404, '收藏记录不存在'); }
      if (writes !== 1 || commitFirst) {
        saved = config.url === '/favorites/toggle' ? !saved : config.method === 'post';
      }
      if (writes === 1 && loseWrite) throw new AxiosError('Response lost', AxiosError.ERR_NETWORK, config);
      data = { message: saved ? '收藏成功' : '取消收藏成功', is_favorited: saved };
    } else throw new Error(`Unexpected request ${config.method} ${config.url}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  return { calls, saved: () => saved, reads: () => reads, writes: () => writes };
}
describe('explicit favorite intent and uncertain writes', () => {
  it.each([false, true])('a lost committed response reconciles without reversing the intended state (initial=%s)', async initial => {
    const read = deferred<{ is_favorited: boolean }>();
    const state = transport({ initial, loseWrite: true, reconciliation: read.promise });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: initial ? '取消收藏' : '收藏' })); await settle();
    expect(state.saved()).toBe(!initial);
    expect(screen.getByRole('button', { name: '收藏' })).toBeDisabled();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(1);
    await act(async () => read.resolve({ is_favorited: !initial })); await settle();
    expect(screen.getByRole('button', { name: initial ? '收藏' : '取消收藏' })).toBeEnabled();
    expect(state.calls).not.toContain('post /favorites/toggle');
    expect(state.calls.filter(call => call === 'get /products/1')).toHaveLength(1);
    expect(state.calls.filter(call => call === 'post /browse/record')).toHaveLength(1);
  });
  it.each(['zh-CN', 'en'] as const)('failed reconciliation offers a read-only retry in %s', async locale => {
    useLocaleStore.setState({ locale });
    const state = transport({ loseWrite: true, readFails: true });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add to favorites' : '收藏' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'en' ? 'Unable to load favorite status. Please try again.' : '加载收藏状态失败，请重试');
    const retry = screen.getByRole('button', { name: locale === 'en' ? 'Retry favorite status' : '重新加载收藏状态' });
    clickTogether(retry, retry); await settle();
    expect(state.saved()).toBe(true); expect(state.reads()).toBe(3); expect(state.writes()).toBe(1);
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Remove from favorites' : '取消收藏' })).toBeEnabled();
  });
  it('a write that never committed can be deliberately retried after reconciliation', async () => {
    const state = transport({ loseWrite: true, commitFirst: false });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(state.saved()).toBe(false); expect(state.reads()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(state.saved()).toBe(true); expect(state.calls.filter(call => call === 'post /favorites')).toHaveLength(2);
  });
  it('removing an already absent receipt completes the desired state', async () => {
    const state = transport({ initial: true, alreadyAbsent: true });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' })); await settle();
    expect(state.saved()).toBe(false); expect(state.calls).toContain('delete /favorites/1');
    expect(screen.getByRole('button', { name: '收藏' })).toBeEnabled();
  });
  it.each([408, 503])('an uncertain HTTP %s triggers reconciliation without repeating the write', async writeStatus => {
    const state = transport({ writeStatus }); render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(1);
  });
  it('a known 400 leaves the confirmed state and does not create a reconciliation loop', async () => {
    const state = transport({ writeStatus: 400 }); render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(state.reads()).toBe(1); expect(state.writes()).toBe(1); expect(state.saved()).toBe(false);
  });
  it('a late reconciliation cannot overwrite a different product', async () => {
    const read = deferred<{ is_favorited: boolean }>();
    const state = transport({ loseWrite: true, reconciliation: read.promise });
    const view = render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(state.reads()).toBe(2);
    navigation.id = '2'; view.rerender(<ProductDetail initialProduct={{ ...product, product_id: 2 }} />); await settle();
    await act(async () => read.resolve({ is_favorited: true })); await settle();
    expect(screen.queryByRole('button', { name: '取消收藏' })).toBeNull();
    expect(screen.getByRole('button', { name: '收藏' })).toBeEnabled();
  });
});
