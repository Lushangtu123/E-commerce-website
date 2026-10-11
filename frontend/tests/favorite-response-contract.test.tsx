import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, clickTogether, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: navigation.id }), useRouter: () => navigation }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: notices }));
const product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0, review_count: 0 };
const originalAdapter = api.defaults.adapter;
beforeEach(() => {
  navigation.id = '1';
  useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
  useAuthStore.setState({ isHydrated: true });
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected fetch'); });
});
afterEach(() => { api.defaults.adapter = originalAdapter; });
function fixture(options: { initial?: boolean; firstRead?: unknown; reply?: unknown; reconcile?: Promise<unknown> } = {}) {
  const { initial = false, firstRead, reply, reconcile } = options;
  let reads = 0, writes = 0;
  const calls: string[] = [];
  api.defaults.adapter = async config => {
    calls.push(`${config.method} ${config.url}`);
    let data: unknown;
    if (config.url === '/products/1') data = { product };
    else if (config.url === '/reviews/product/1') data = { reviews: [], total: 0, totalPages: 0 };
    else if (config.url === '/recommendations/related/1') data = { related_products: [] };
    else if (config.url === '/browse/record') data = {};
    else if (config.url === '/favorites/check/1') {
      reads++;
      data = reads === 1 ? (Object.hasOwn(options, 'firstRead') ? firstRead : { is_favorited: initial }) : reconcile ? await reconcile : { is_favorited: !initial };
    } else if (config.url === '/favorites' || config.url === '/favorites/1') {
      writes++; data = Object.hasOwn(options, 'reply') ? reply : (initial ? { message: '取消收藏成功' } : { message: '收藏成功', favorite_id: 10 });
    } else throw new Error(`Unexpected request ${config.method} ${config.url}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  return { calls, reads: () => reads, writes: () => writes };
}
describe('favorite response contract through the API client', () => {
  it.each([undefined, null, [], {}, { is_favorited: 'false' }, { is_favorited: 0 },
    { is_favorited: false, success: false }, { is_favorited: true, error: '检查收藏状态失败' }])('invalid favorite state %j offers a read-only retry', async firstRead => {
    const state = fixture({ firstRead });
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载收藏状态失败，请重试');
    const action = screen.getByRole('button', { name: '收藏' });
    expect(action).toBeDisabled(); await captureHandler(action)();
    clickTogether(screen.getByRole('button', { name: '重新加载收藏状态' }), screen.getByRole('button', { name: '重新加载收藏状态' }));
    await settle();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(0);
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeEnabled();
  });
  it.each([undefined, null, [], {}, { message: '收藏成功' }, { message: '收藏成功', favorite_id: 0 },
    { message: '收藏成功', favorite_id: '1' }, { message: '该商品已在收藏夹中', already_favorited: false },
    { message: '收藏成功', favorite_id: 10, error: '添加收藏失败' },
    { message: '收藏成功', favorite_id: 10, is_favorited: false }])('invalid add receipt %j is checked instead of published or repeated', async reply => {
    const state = fixture({ reply });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(notices.success).not.toHaveBeenCalled();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(1);
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeEnabled();
  });
  it.each(['zh-CN', 'en'] as const)('invalid reconciliation stays locked and retries only GET (%s)', async locale => {
    useLocaleStore.setState({ locale });
    const checking = deferred<unknown>();
    const state = fixture({ reply: {}, reconcile: checking.promise });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add to favorites' : '收藏' })); await settle();
    await act(async () => checking.resolve({ is_favorited: 'true' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'en' ? 'Unable to load favorite status. Please try again.' : '加载收藏状态失败，请重试');
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Add to favorites' : '收藏' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Retry favorite status' : '重新加载收藏状态' })); await settle();
    expect(state.reads()).toBe(3); expect(state.writes()).toBe(1);
    expect(notices.success).not.toHaveBeenCalled();
  });
  it.each([
    { initial: false, reply: { message: '收藏成功', favorite_id: 10 }, expected: '取消收藏' },
    { initial: false, reply: { message: '该商品已在收藏夹中', already_favorited: true }, expected: '取消收藏' },
    { initial: true, reply: { message: '取消收藏成功' }, expected: '收藏' },
  ])('valid official favorite receipt is confirmed without an extra GET: %j', async ({ initial, reply, expected }) => {
    const state = fixture({ initial, reply });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: initial ? '取消收藏' : '收藏' })); await settle();
    expect(state.reads()).toBe(1); expect(state.writes()).toBe(1);
    expect(screen.getByRole('button', { name: expected })).toBeEnabled();
    expect(notices.success).toHaveBeenCalledExactlyOnceWith(reply.message);
  });
  it('an invalid remove receipt reconciles the current state without repeating DELETE', async () => {
    const state = fixture({ initial: true, reply: { message: '取消收藏成功', success: false } });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' })); await settle();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(1);
    expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '收藏' })).toBeEnabled();
    expect(state.calls.filter(call => call === 'delete /favorites/1')).toHaveLength(1);
  });
  it('does not publish a fake success from a negative HTTP200 acknowledgement and checks before any new write', async () => {
    const checking = deferred<unknown>();
    const state = fixture({ reply: { success: false, message: '添加收藏失败' }, reconcile: checking.promise });
    render(<ProductDetail initialProduct={product} />); await settle();
    const staleAction = captureHandler(screen.getByRole('button', { name: '收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(notices.success).not.toHaveBeenCalled();
    expect(state.reads()).toBe(2); expect(state.writes()).toBe(1);
    expect(screen.getByRole('button', { name: '收藏' })).toBeDisabled();
    await staleAction(); expect(state.writes()).toBe(1);
    await act(async () => checking.resolve({ is_favorited: false })); await settle();
    expect(screen.getByRole('button', { name: '收藏' })).toBeEnabled();
    expect(state.writes()).toBe(1);
  });
});
