import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLogsPage from '@/app/admin/logs/page';
import api, { type AdminLog } from '@/lib/api';
import { clearAdminSession } from '@/lib/admin-session';
import { logger } from '@/lib/logger';
import { apiError, captureHandler, deferred, render, settle } from './helpers';
import { installCatalogRouter, useCatalogSearchParams } from './catalog-router';
import { useLocaleStore } from '@/store/useLocaleStore';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const query = vi.hoisted(() => ({ current: new URLSearchParams(), listeners: new Set<() => void>(), ready: true }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/logs', useSearchParams: () => {
  const params = useCatalogSearchParams(query);
  return query.ready ? params : null;
} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

type Logs = { logs: AdminLog[]; pagination: { total: number } };
type Params = { page: number; limit: number; action?: string; adminId?: string; startDate?: string; endDate?: string };

const admin = (username: string, admin_id = 1) => JSON.stringify({ admin_id, username, real_name: null, role_name: '管理员' });
const log = (description: string): AdminLog => ({ log_id: 1, username: 'administrator', action: 'LOGIN', description, created_at: '2026-10-04T12:00:00Z' });
const originalAdapter = api.defaults.adapter;
let requests: { url?: string; params: Params }[] = [];

/** Signs the first administrator in and answers the real API client at the transport layer. */
async function setup(get: (params: Params) => Promise<Logs> | Logs) {
  localStorage.setItem('admin_session', 'first-session');
  localStorage.setItem('admin_user', admin('first'));
  const adapter: AxiosAdapter = async config => {
    requests.push({ url: config.url, params: config.params });
    return { data: await get(config.params), status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<AdminLogsPage />);
  await settle();
  return view;
}

function switchAdmin({ notify }: { notify: boolean }) {
  localStorage.setItem('admin_session', 'second-session');
  localStorage.setItem('admin_user', admin('second', 2));
  if (notify) act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_user' })); });
}

async function click(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await settle();
}

describe('admin logs', () => {
  beforeEach(() => {
    requests = [];
    query.current = new URLSearchParams(); query.listeners.clear(); query.ready = true;
    installCatalogRouter(router, query);
    window.history.replaceState(null, '', '/admin/logs');
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('restores deep-link filters and page, with bilingual after-sales actions', async () => {
    act(() => router.replace('/admin/logs?action=REVIEW_AFTER_SALES&adminId=2&startDate=2026-10-01&endDate=2026-10-10&page=2'));
    await setup(() => ({ logs: [{ ...log('Reviewed'), action: 'REVIEW_AFTER_SALES' }, { ...log('Completed'), log_id: 2, action: 'COMPLETE_AFTER_SALES' }], pagination: { total: 41 } }));
    expect(requests[0].params).toEqual({ page: 2, limit: 20, action: 'REVIEW_AFTER_SALES', adminId: '2', startDate: '2026-10-01', endDate: '2026-10-10' });
    expect(screen.getByLabelText('管理员编号')).toHaveValue('2');
    expect(screen.getAllByText('审核售后申请').length).toBeGreaterThan(0);
    expect(screen.getAllByText('售后结案').length).toBeGreaterThan(0);
    act(() => useLocaleStore.getState().setLocale('en'));
    expect(screen.getAllByText('Review after-sales request').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Complete after-sales request').length).toBeGreaterThan(0);
  });

  it('applies trimmed filters once, resets pagination and restores browser history', async () => {
    await setup(params => ({ logs: [log(`${params.action || 'all'} page ${params.page}`)], pagination: { total: 41 } }));
    await click('下一页');
    fireEvent.change(screen.getByLabelText('操作类型'), { target: { value: 'COMPLETE_AFTER_SALES' } });
    fireEvent.change(screen.getByLabelText('管理员编号'), { target: { value: ' 2 ' } });
    expect(requests).toHaveLength(2);
    await click('筛选');
    expect(requests.at(-1)?.params).toEqual({ page: 1, limit: 20, action: 'COMPLETE_AFTER_SALES', adminId: '2' });
    expect(new URLSearchParams(window.location.search).get('adminId')).toBe('2');
    const saved = window.location.pathname + window.location.search;
    await click('下一页');
    expect(requests.at(-1)?.params.page).toBe(2);
    act(() => router.replace(saved)); await settle();
    expect(screen.getByText('COMPLETE_AFTER_SALES page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('管理员编号')).toHaveValue('2');
    await click('重置');
    expect(window.location.search).toBe('');
    expect(requests.at(-1)?.params).toEqual({ page: 1, limit: 20 });
  });

  it.each(['adminId=0', 'adminId=2x', 'adminId=01', 'adminId=9007199254740992', 'startDate=2026-02-30', 'startDate=2026-10-10&endDate=2026-10-01', 'adminId=1&adminId=2', 'page=2&page=3', 'page=10001', `action=${'x'.repeat(51)}`])('does not silently broaden an invalid deep link (%s)', async params => {
    act(() => router.replace(`/admin/logs?${params}`));
    await setup(() => ({ logs: [], pagination: { total: 0 } }));
    expect(requests).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('日志筛选条件无效');
    await click('重置');
    expect(requests).toHaveLength(1);
    expect(screen.getByText('暂无操作日志')).toBeInTheDocument();
  });

  it('preserves the applied query when draft dates are reversed, then accepts a valid range', async () => {
    await setup(() => ({ logs: [], pagination: { total: 0 } }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
    await click('筛选'); expect(requests).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('日志筛选条件无效');
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-11' } });
    await click('筛选');
    expect(requests.at(-1)?.params).toEqual({ page: 1, limit: 20, startDate: '2026-10-10', endDate: '2026-10-11' });
  });

  it('discards a previous filter response and saved handlers while the URL changes', async () => {
    const pending = deferred<Logs>();
    await setup(params => params.action === 'LOGIN' ? pending.promise : { logs: [log('Current')], pagination: { total: 41 } });
    const oldNext = captureHandler(screen.getByRole('button', { name: '下一页' }));
    fireEvent.change(screen.getByLabelText('操作类型'), { target: { value: 'LOGIN' } });
    await click('筛选');
    await oldNext(); expect(requests).toHaveLength(2);
    await click('重置');
    await act(async () => pending.resolve({ logs: [log('Old filter')], pagination: { total: 41 } })); await settle();
    expect(screen.queryByText('Old filter')).not.toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('clears filters and page when the administrator changes', async () => {
    act(() => router.replace('/admin/logs?action=LOGIN&adminId=1&page=2'));
    await setup(params => ({ logs: [log(`Page ${params.page}`)], pagination: { total: 41 } }));
    switchAdmin({ notify: true }); await settle();
    expect(window.location.search).toBe('');
    expect(requests.at(-1)?.params).toEqual({ page: 1, limit: 20 });
    expect(screen.getByLabelText('管理员编号')).toHaveValue('');
  });

  it('keeps unknown historical action codes readable and filters them without coercion', async () => {
    act(() => router.replace('/admin/logs?action=constructor'));
    await setup(() => ({ logs: [{ ...log('Legacy'), action: 'constructor' }], pagination: { total: 1 } }));
    expect(requests[0].params.action).toBe('constructor');
    expect(screen.getAllByText('constructor')).toHaveLength(2);
    expect(screen.getByLabelText('操作类型')).toHaveValue('constructor');
  });

  it.each([0, 1])('lets an administrator leave a deep-linked page beyond the current last page (total=%s)', async total => {
    act(() => router.replace('/admin/logs?action=LOGIN&page=3'));
    await setup(params => ({ logs: params.page === 1 && total ? [log('First page')] : [], pagination: { total } }));
    await click('上一页');
    expect(requests.at(-1)?.params.page).toBeLessThan(3);
    expect(new URLSearchParams(window.location.search).get('action')).toBe('LOGIN');
  });

  it('waits for nullable Next search parameters before requesting or applying filters', async () => {
    query.ready = false;
    await setup(() => ({ logs: [], pagination: { total: 0 } }));
    expect(requests).toHaveLength(0);
    expect(screen.getByRole('button', { name: '筛选' })).toBeDisabled();
    act(() => {
      query.ready = true;
      router.replace('/admin/logs?action=LOGIN&page=2');
    }); await settle();
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toEqual({ page: 2, limit: 20, action: 'LOGIN' });
  });

  it('waits for the actual URL before clearing a replaced administrator’s filters', async () => {
    query.ready = false;
    act(() => router.replace('/admin/logs?action=LOGIN&page=2&trace=keep'));
    await setup(() => ({ logs: [], pagination: { total: 0 } }));
    switchAdmin({ notify: true }); await settle();
    expect(window.location.search).toBe('?action=LOGIN&page=2&trace=keep');
    expect(requests).toHaveLength(0);
    act(() => {
      query.ready = true;
      query.current = new URLSearchParams(window.location.search);
      query.listeners.forEach(listener => listener());
    }); await settle();
    expect(window.location.search).toBe('?trace=keep');
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toEqual({ page: 1, limit: 20 });
  });

  it('reads through the shared API client and shows a retryable error instead of an empty table', async () => {
    let calls = 0;
    await setup(async () => {
      if (++calls === 1) throw apiError('获取日志失败');
      return { logs: [log('Current logs')], pagination: { total: 1 } };
    });

    expect(requests[0]).toEqual({ url: '/admin/logs', params: { page: 1, limit: 20 } });
    expect(screen.getByRole('alert')).toHaveTextContent('获取日志失败');
    expect(logger.error).toHaveBeenCalledTimes(1);

    await click('重新加载');
    expect(screen.getByText('Current logs')).toBeInTheDocument();
  });

  it('discards a delayed response for a page the previous administrator requested', async () => {
    const delayed = deferred<Logs>();
    let calls = 0;
    await setup(params => ++calls === 2 ? delayed.promise : { logs: [log(`Page ${params.page}`)], pagination: { total: 41 } });

    await click('下一页');
    switchAdmin({ notify: true });
    await settle();
    expect(screen.getByText('Page 1')).toBeInTheDocument();

    await act(async () => delayed.resolve({ logs: [log('Old page')], pagination: { total: 41 } }));
    await settle();
    expect(screen.queryByText('Old page')).not.toBeInTheDocument();
  });

  const lateCases = (['storage', 'unmount'] as const).flatMap(change =>
    ([false, true] as const).map(fails => ({ change, fails })));

  it.each(lateCases)('ignores an old outcome (fails=$fails) after a $change change, even before the storage event arrives', async ({ change, fails }) => {
    const delayed = deferred<Logs>();
    const view = await setup(() => requests.length === 1 ? delayed.promise : { logs: [log('Second administrator logs')], pagination: { total: 1 } });

    if (change === 'storage') switchAdmin({ notify: false });
    else view.unmount();
    await act(async () => {
      if (fails) delayed.reject(new Error('Old failure'));
      else delayed.resolve({ logs: [log('Old logs')], pagination: { total: 1 } });
    });
    await settle();
    if (change === 'storage') {
      act(() => view.rerender(<AdminLogsPage />));
      await settle();
      // The token is read on every render, so the page catches up with the new administrator at once.
      expect(screen.getByText('Second administrator logs')).toBeInTheDocument();
    }

    expect(screen.queryByText('Old logs')).not.toBeInTheDocument();
    expect(screen.queryByText('Old failure')).not.toBeInTheDocument();
  });

  it('cannot invalidate the pending current page through a saved old pagination handler', async () => {
    const delayed = deferred<Logs>();
    await setup(params => params.page === 2 ? delayed.promise : { logs: [log('First page')], pagination: { total: 41 } });
    const next = captureHandler(screen.getByRole('button', { name: '下一页' }));

    await next();
    await settle();
    await next();
    await act(async () => delayed.resolve({ logs: [log('Second page')], pagination: { total: 41 } }));
    await settle();

    expect(screen.getByText('Second page')).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('hides the logs as soon as this tab clears the administrator session', async () => {
    await setup(() => ({ logs: [log('Current logs')], pagination: { total: 1 } }));
    expect(screen.getByText('Current logs')).toBeInTheDocument();

    act(() => { clearAdminSession('first-session'); });

    expect(screen.queryByText('Current logs')).not.toBeInTheDocument();
  });

  it('ignores a saved previous-page handler once the page has moved on', async () => {
    await setup(params => ({ logs: [log(`Page ${params.page}`)], pagination: { total: 61 } }));
    await click('下一页');
    const stalePrevious = captureHandler(screen.getByRole('button', { name: '上一页' }));
    await click('下一页');
    expect(screen.getByText('Page 3')).toBeInTheDocument();

    await stalePrevious();
    await settle();
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    expect(requests).toHaveLength(3);
  });

  it('sends no retry for the administrator another tab replaced, before the storage event arrives', async () => {
    await setup(async () => { throw apiError('获取日志失败'); });
    switchAdmin({ notify: false });

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    // The API client would send a stale retry with the new token, so the only safe outcome is no request.
    expect(requests).toHaveLength(1);
  });
});
