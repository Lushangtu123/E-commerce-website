import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, clickTogether, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
beforeEach(() => {
  useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
  useAuthStore.setState({ isHydrated: true });
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected fetch'); });
});
afterEach(() => { api.defaults.adapter = originalAdapter; });
function fixture(read: (count: number, userId: string) => Promise<unknown>) {
  let reads = 0;
  const calls: string[] = [];
  api.defaults.adapter = async config => {
    calls.push(`${config.method} ${config.url}`);
    let data: unknown;
    if (config.url === '/cart') data = { items: [] };
    else if (config.url === '/search/hot') data = { keywords: [{ keyword: 'Popular keyword', search_count: 1 }] };
    else if (config.url === '/search/history' && config.method === 'get') data = await read(++reads, String(config.headers.get('X-Expected-Customer-Id')));
    else throw new Error(`Unexpected request ${config.method} ${config.url}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  return { reads: () => reads, calls };
}
async function openDropdown() {
  fireEvent.focus(screen.getByRole('textbox')); await settle();
}
describe('initial search-history read recovery through the API client', () => {
  it('keeps initial loading distinct from an empty saved history', async () => {
    const initial = deferred<unknown>();
    const state = fixture(async () => initial.promise);
    render(<Header />); await settle(); await openDropdown();
    expect(screen.getByRole('status')).toHaveTextContent('加载中...');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => initial.resolve({ history: [] })); await settle();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('搜索历史')).toBeNull();
    expect(screen.getByText('Popular keyword')).toBeVisible();
    expect(state.reads()).toBe(1);
  });
  it('switches the initial read error into English and preserves the unsubmitted search during a coalesced retry', async () => {
    const retryRead = deferred<unknown>();
    const state = fixture(async count => {
      if (count === 1) throw new AxiosError('Reply lost', 'ERR_NETWORK');
      return retryRead.promise;
    });
    render(<Header />); await settle(); await openDropdown();
    expect(screen.getByRole('alert')).toHaveTextContent('加载搜索历史失败，请重试');
    act(() => useLocaleStore.setState({ locale: 'en' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load search history. Please try again.');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsubmitted query' } });
    const retry = captureHandler(screen.getByRole('button', { name: 'Reload search history' }));
    const firstRetry = retry(); await retry(); await settle();
    expect(state.reads()).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    await act(async () => retryRead.resolve({ history: [{ keyword: 'Saved keyword' }] }));
    await firstRetry; await settle();
    expect(screen.getByText('Saved keyword')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('Unsubmitted query');
    expect(state.reads()).toBe(2);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(state.calls.filter(call => call.startsWith('post ') || call.startsWith('delete '))).toEqual([]);
  });
  it.each(['initial', 'retry'] as const)('discards old-account responses and captured retries when switching during %s', async stage => {
    const oldRead = deferred<unknown>();
    const state = fixture(async (count, userId) => {
      if (userId === '2') return { history: [{ keyword: 'Other account keyword' }] };
      if (stage === 'retry' && count === 1) throw new AxiosError('Reply lost', 'ERR_NETWORK');
      return oldRead.promise;
    });
    render(<Header />); await settle(); await openDropdown();
    const staleRetry = stage === 'retry' ? captureHandler(screen.getByRole('button', { name: '重新加载搜索历史' })) : null;
    const work = staleRetry?.(); await settle();
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Other', email: 'other@example.test' }, 'second-session'));
    await settle(); await openDropdown();
    await staleRetry?.();
    await act(async () => oldRead.resolve({ history: [{ keyword: 'Private old-account keyword' }] }));
    await work; await settle();
    expect(state.reads()).toBe(stage === 'initial' ? 2 : 3);
    expect(screen.getByText('Other account keyword')).toBeVisible();
    expect(screen.queryByText('Private old-account keyword')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([{}, { history: null }, { history: [{ keyword: 1 }] }, { history: [], success: false }, { history: [], error: '获取搜索历史失败' }])('an invalid HTTP payload %j cannot hide a failed history read as an empty list', async payload => {
    const state = fixture(async count => count === 1 ? payload : { history: [] });
    render(<Header />); await settle(); await openDropdown();
    expect(screen.getByRole('alert')).toHaveTextContent('加载搜索历史失败，请重试');
    fireEvent.click(screen.getByRole('button', { name: '重新加载搜索历史' })); await settle();
    expect(state.reads()).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('搜索历史')).toBeNull();
  });
  it('shows an initial GET failure and can retry only that read without submitting a search', async () => {
    const state = fixture(async count => {
      if (count === 1) throw new AxiosError('Unavailable', 'ERR_BAD_RESPONSE', undefined, undefined, { status: 503, statusText: 'Failure', headers: {}, config: {} as never, data: { message: '获取搜索历史失败' } });
      return { history: [{ keyword: 'Saved keyword' }] };
    });
    render(<Header />); await settle(); await openDropdown();
    expect(screen.getByRole('alert')).toHaveTextContent('加载搜索历史失败，请重试');
    const retry = screen.getByRole('button', { name: '重新加载搜索历史' });
    clickTogether(retry, retry); await settle();
    expect(state.reads()).toBe(2);
    expect(screen.getByText('Saved keyword')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(state.calls.filter(call => call.startsWith('post ') || call.startsWith('delete '))).toEqual([]);
  });
});
