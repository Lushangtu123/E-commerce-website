import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLogsPage from '@/app/admin/logs/page';
import api, { type AdminLog } from '@/lib/api';
import { clearAdminSession } from '@/lib/admin-session';
import { logger } from '@/lib/logger';
import { apiError, captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/logs' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

type Logs = { logs: AdminLog[]; pagination: { total: number } };
type Params = { page: number; limit: number };

const admin = (username: string, admin_id = 1) => JSON.stringify({ admin_id, username, real_name: null, role_name: '管理员' });
const log = (description: string): AdminLog => ({ log_id: 1, username: 'administrator', action: 'LOGIN', description, created_at: '2026-10-04T12:00:00Z' });
const originalAdapter = api.defaults.adapter;
let requests: { url?: string; params: Params }[] = [];

/** Signs the first administrator in and answers the real API client at the transport layer. */
async function setup(get: (params: Params) => Promise<Logs> | Logs) {
  localStorage.setItem('admin_token', 'first-session');
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
  localStorage.setItem('admin_token', 'second-session');
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
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
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
