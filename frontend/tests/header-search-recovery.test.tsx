import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import api, { type SearchKeyword } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: notices, toast: notices }));

type History = { history: SearchKeyword[] };
type Outcome = 'success' | 'network' | number;
const buyer = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
const otherBuyer = { user_id: 2, username: 'Other buyer', email: 'other@example.test' };
const row = (keyword: string) => ({ keyword });
const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  useAuthStore.getState().login(buyer, 'session-A');
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected fetch'); });
});
afterEach(() => { api.defaults.adapter = originalAdapter; });

async function fixture({ outcome = 'network', commit = true,
  read, remove,
}: {
  outcome?: Outcome;
  commit?: boolean;
  read?: (count: number, history: History) => Promise<unknown>;
  remove?: () => Promise<void>;
} = {}) {
  let canonical = [row('Delete me'), row('Keep me')];
  let reads = 0, deletes = 0;
  const requests: { method: string; customer: string }[] = [];
  api.defaults.adapter = async config => {
    let data: unknown;
    const customer = String(config.headers.get('X-Expected-Customer-Id'));
    if (config.url === '/cart') data = { items: [] };
    else if (config.url === '/search/hot') data = { keywords: [] };
    else if (config.url === '/search/record') data = { message: '记录成功', id: 1 };
    else if (config.url === '/search/history' && config.method === 'get') {
      reads++;
      requests.push({ method: 'get', customer });
      const history = { history: customer === '2' ? [row('Other account')] : [...canonical] };
      data = read ? await read(reads, history) : history;
    } else if (config.url?.startsWith('/search/history/') && config.method === 'delete') {
      deletes++;
      requests.push({ method: 'delete', customer });
      if (commit) canonical = canonical.filter(item => item.keyword !== decodeURIComponent(config.url!.split('/').at(-1)!));
      if (remove) await remove();
      if (outcome !== 'success') throw failure(outcome, config);
      data = { message: '删除成功' };
    } else throw new Error(`Unexpected API ${config.method} ${config.url}`);
    return { config, status: 200, statusText: 'OK', headers: {}, data };
  };
  const view = render(<Header />);
  await settle();
  fireEvent.focus(screen.getByRole('textbox'));
  await settle();
  return { ...view, state: () => ({ canonical, reads, deletes, requests }) };
}

function failure(outcome: Exclude<Outcome, 'success'>, config?: InternalAxiosRequestConfig) {
  return outcome === 'network' ? new AxiosError('Reply lost', 'ERR_NETWORK', config)
    : Object.assign(new Error('Rejected'), { config, response: { status: outcome, data: { message: '搜索记录不存在' }, config } });
}
const removeButton = (keyword = 'Delete me', locale = 'zh-CN') => screen.getByRole('button', {
  name: locale === 'en' ? `Delete search history: ${keyword}` : `删除搜索历史：${keyword}`,
});
const retryButton = (locale = 'zh-CN') => screen.getByRole('button', {
  name: locale === 'en' ? 'Reload search history' : '重新加载搜索历史',
});

describe('search-history deletion recovery through the API client', () => {
  it.each(['success', 'network', 404, 408, 429, 500] as const)('reconciles %s with one read and no repeated DELETE', async outcome => {
    const current = await fixture({ outcome });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Unsubmitted query  ' } });
    fireEvent.click(removeButton());
    await settle();

    expect(current.state()).toMatchObject({ canonical: [row('Keep me')], reads: 2, deletes: 1 });
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(screen.getByText('Keep me')).toBeVisible();
    expect(removeButton('Keep me')).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveValue('  Unsubmitted query  ');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains a definitively refused keyword without a recovery GET', async () => {
    const current = await fixture({ outcome: 400, commit: false });
    fireEvent.click(removeButton());
    await settle();
    expect(current.state()).toMatchObject({ reads: 1, deletes: 1 });
    expect(screen.getByText('Delete me')).toBeVisible();
    expect(removeButton()).toBeEnabled();
  });

  it('keeps a keyword that the checking read proves is still saved', async () => {
    const current = await fixture({ commit: false });
    fireEvent.click(removeButton());
    await settle();
    expect(current.state()).toMatchObject({ reads: 2, deletes: 1 });
    expect(screen.getByText('Delete me')).toBeVisible();
    expect(removeButton()).toBeEnabled();
  });

  it.each(['zh-CN', 'en'] as const)('shows a translated read-only retry and coalesces retries after GET failure (%s)', async locale => {
    useLocaleStore.setState({ locale });
    const retry = deferred<History>();
    const current = await fixture({ read: async (count, data) => {
      if (count === 2) throw failure('network');
      return count === 3 ? retry.promise : data;
    } });
    const staleDelete = captureHandler(removeButton('Keep me', locale));
    fireEvent.click(removeButton('Delete me', locale));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'en'
      ? 'Unable to load search history. Please try again.' : '加载搜索历史失败，请重试');
    expect(removeButton('Delete me', locale)).toBeDisabled();
    expect(removeButton('Keep me', locale)).toBeDisabled();
    await staleDelete();
    const retryRead = captureHandler(retryButton(locale));
    const firstRetry = retryRead();
    await retryRead();
    await settle();
    expect(current.state()).toMatchObject({ reads: 3, deletes: 1 });
    expect(retryButton(locale)).toBeDisabled();
    await staleDelete();
    await act(async () => retry.resolve({ history: [row('Keep me')] }));
    await firstRetry;
    await settle();

    expect(current.state()).toMatchObject({ reads: 3, deletes: 1 });
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(removeButton('Keep me', locale)).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([{}, { history: null }, { history: [{ keyword: 9 }] }])('keeps deletion locked after an invalid history read: %j', async payload => {
    const current = await fixture({ read: async (count, data) => count === 2 ? payload : data });
    fireEvent.click(removeButton());
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载搜索历史失败，请重试');
    expect(removeButton()).toBeDisabled();
    fireEvent.click(retryButton());
    await settle();
    expect(current.state()).toMatchObject({ reads: 3, deletes: 1 });
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(removeButton('Keep me')).toBeEnabled();
  });

  it('blocks captured deletes of both keywords until the pending write and checking read finish', async () => {
    const deletion = deferred<void>(), checking = deferred<History>();
    const current = await fixture({ outcome: 'success', remove: () => deletion.promise,
      read: async (count, data) => count === 2 ? checking.promise : data });
    const first = captureHandler(removeButton()), second = captureHandler(removeButton('Keep me'));
    const work = first();
    await first();
    await second();
    await settle();
    expect(current.state()).toMatchObject({ reads: 1, deletes: 1 });
    expect(removeButton('Keep me')).toBeDisabled();

    await act(async () => deletion.resolve());
    await settle();
    await first();
    await second();
    expect(current.state()).toMatchObject({ reads: 2, deletes: 1 });
    await act(async () => checking.resolve({ history: [row('Keep me')] }));
    await work;
    await settle();

    fireEvent.click(removeButton('Keep me'));
    await settle();
    expect(current.state()).toMatchObject({ canonical: [], reads: 3, deletes: 2 });
    expect(screen.queryByText('Keep me')).not.toBeInTheDocument();
  });

  it.each(['delete', 'read'] as const)('never reconciles or publishes the old account after switching during %s', async stage => {
    const pendingDelete = deferred<void>(), pendingRead = deferred<History>();
    const current = await fixture({ remove: stage === 'delete' ? () => pendingDelete.promise : undefined,
      read: async (count, data) => stage === 'read' && count === 2 ? pendingRead.promise : data });
    const staleDelete = captureHandler(removeButton());
    const work = staleDelete();
    await settle();
    act(() => useAuthStore.getState().login(otherBuyer, 'session-B'));
    await settle();
    fireEvent.focus(screen.getByRole('textbox'));
    await settle();
    await staleDelete();
    await act(async () => {
      if (stage === 'delete') pendingDelete.reject(failure('network'));
      else pendingRead.resolve({ history: [row('Private old account')] });
    });
    await work;
    await settle();

    expect(current.state().deletes).toBe(1);
    expect(current.state().requests.filter(request => request.customer === '1' && request.method === 'get')).toHaveLength(stage === 'delete' ? 1 : 2);
    expect(screen.getByText('Other account')).toBeVisible();
    expect(screen.queryByText('Private old account')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(removeButton('Other account')).toBeEnabled();
  });

  it.each(['success', 'failure'] as const)('ignores an older checking response after the latest history read %s', async latest => {
    const oldRead = deferred<History>();
    const current = await fixture({ read: async (count, data) => {
      if (count === 2) return oldRead.promise;
      if (count === 3 && latest === 'failure') throw failure('network');
      return data;
    } });
    fireEvent.click(removeButton());
    await settle();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New query' } });
    fireEvent.submit(screen.getByRole('search'));
    await settle();
    await act(async () => oldRead.resolve({ history: [row('Obsolete deleted keyword')] }));
    await settle();
    fireEvent.focus(screen.getByRole('textbox'));
    await settle();

    expect(current.state()).toMatchObject({ reads: 3, deletes: 1 });
    expect(screen.queryByText('Obsolete deleted keyword')).not.toBeInTheDocument();
    if (latest === 'failure') {
      expect(screen.getByRole('alert')).toBeVisible();
      expect(removeButton('Keep me')).toBeDisabled();
      fireEvent.click(retryButton());
      await settle();
      expect(current.state()).toMatchObject({ reads: 4, deletes: 1 });
    }
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
    expect(removeButton('Keep me')).toBeEnabled();
  });
});
