import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import AdminLogsPage from '@/app/admin/logs/page';
import api from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/logs', useSearchParams: () => router.params }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });

const row = { log_id: 1, action: 'OLD_CUSTOM_ACTION', username: null, real_name: null, description: null, ip_address: null, created_at: '2026-10-10T00:00:00Z' };
const invalidResponses: unknown[] = [
  null, {}, { logs: [], pagination: null }, { logs: {}, pagination: { total: 0 } },
  { logs: [], pagination: { total: -1 } }, { logs: [], pagination: { total: true } }, { logs: [], pagination: { total: '1' } },
  { logs: [], pagination: { total: 0, page: 2 } }, { logs: [], pagination: { total: 0, limit: 50 } },
  { logs: [], pagination: { total: 0, totalPages: 1 } },
  ...[null, { ...row, log_id: 0 }, { ...row, action: {} }, { ...row, description: {} }, { ...row, created_at: 'invalid' }]
    .map(value => ({ logs: [value], pagination: { total: 1 } })),
  { logs: [row, row], pagination: { total: 2 } },
];

it.each(invalidResponses.map((value, index) => ({ value, index })))('rejects invalid log snapshot $index and offers a bilingual GET-only retry', async ({ value }) => {
  localStorage.setItem('admin_session', 'log-response-session');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  const methods: string[] = [];
  api.defaults.adapter = async config => {
    methods.push(config.method!);
    return { config, status: 200, statusText: 'OK', headers: {}, data: methods.length === 1 ? value : { logs: [row], pagination: { total: 1 } } };
  };
  render(<AdminLogsPage />); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('获取日志失败');
  expect(screen.queryByText('暂无操作日志')).not.toBeInTheDocument();
  act(() => useLocaleStore.getState().setLocale('en'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('获取日志失败');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await settle();
  expect(screen.getByText('OLD_CUSTOM_ACTION')).toBeInTheDocument();
  expect(methods).toEqual(['get', 'get']);
});

it('keeps invalid successful log responses retryable instead of crashing or showing an empty table', async () => {
  localStorage.setItem('admin_session', 'log-response-session');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin' }));
  let calls = 0;
  api.defaults.adapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
    data: ++calls === 1 ? { logs: [] } : { logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
  render(<AdminLogsPage />);
  await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('获取日志失败');
  expect(screen.queryByText('暂无操作日志')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await settle();
  expect(screen.getByText('暂无操作日志')).toBeInTheDocument();
  expect(calls).toBe(2);
});
