'use client';

import '@/lib/admin-i18n';
import { useI18n } from '@/lib/i18n';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/AdminLayout';
import { logger } from '@/lib/logger';
import api from '@/lib/api';
import type { AdminLog } from '@/lib/api';
import { useAdminQuery, useAdminSessionId } from '@/hooks/use-admin-query';
import { requestFailure } from '@/lib/api-error';
import { emptyLogFilters, logActionLabels, logFilterKeys, logFiltersUrl, normalizeLogFilters, readLogFilters, type LogFilters } from '@/lib/admin-log-filters';

export default function AdminLogsPage() {
  const { t } = useI18n();
  return <Suspense fallback={<div role="status" className="p-8 text-center">{t('加载中...')}</div>}><AdminLogsContent /></Suspense>;
}

function AdminLogsContent() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlKey = searchParams?.toString() ?? '';
  const sessionId = useAdminSessionId();
  // The first session claims the deep link. A replacement waits until the old filters leave the URL.
  const [owner, setOwner] = useState<string | null>(null);
  const ownsFilters = owner === null || owner === sessionId;
  const cleared = searchParams !== null && [...logFilterKeys, 'page'].every(key => !searchParams.has(key));
  if (sessionId && (owner === null || (!ownsFilters && cleared))) setOwner(sessionId);
  const applied = readLogFilters(ownsFilters ? urlKey : '');
  const { filters, page } = applied;
  const viewKey = JSON.stringify([sessionId, urlKey]);
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  const [draftState, setDraftState] = useState({ key: viewKey, filters });
  const draft = draftState.key === viewKey ? draftState.filters : filters;
  const [formError, setFormError] = useState<{ key: string; message: string } | null>(null);
  const query = useAdminQuery({
    name: 'logs',
    params: [page, filters],
    enabled: searchParams !== null && ownsFilters && !applied.error,
    load: () => api.get<unknown, { logs: AdminLog[]; pagination: { total: number } }>('/admin/logs', {
      params: { page, limit: 20, ...Object.fromEntries(logFilterKeys.filter(key => filters[key]).map(key => [key, filters[key]])) },
    }),
  });
  const logs = query.data?.logs ?? [];
  const total = query.data?.pagination.total ?? 0;
  const error = query.error
    ? requestFailure(query.error).response?.data?.error || requestFailure(query.error).message || '获取日志失败'
    : undefined;
  const loading = !query.data && !error;
  const isCurrentView = () => searchParams !== null && ownsFilters && query.isCurrentSession() && currentView.current === viewKey &&
    new URLSearchParams(window.location.search).toString() === urlKey;

  useEffect(() => {
    if (!sessionId || searchParams === null) return;
    if (owner !== null && owner !== sessionId && !cleared) router.replace(logFiltersUrl(urlKey, emptyLogFilters), { scroll: false });
  }, [sessionId, owner, cleared, router, urlKey, searchParams]);

  useEffect(() => {
    if (query.error) logger.error('获取日志失败:', query.error);
  }, [query.error]);

  const navigate = (nextFilters: LogFilters, nextPage = 1) => {
    if (!isCurrentView()) return;
    const href = logFiltersUrl(urlKey, nextFilters, nextPage);
    if (href !== `/admin/logs${urlKey ? `?${urlKey}` : ''}`) {
      currentView.current = '';
      router.push(href, { scroll: false });
    }
  };
  const changePage = (next: number) => {
    if (!query.data || applied.error || next < 1 || next > Math.max(1, Math.min(10000, Math.ceil(total / 20)))) return;
    navigate(filters, next);
  };
  const changeDraft = (key: keyof LogFilters, value: string) => {
    if (!isCurrentView()) return;
    setDraftState({ key: viewKey, filters: { ...draft, [key]: value } }); setFormError(null);
  };
  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isCurrentView()) return;
    const normalized = normalizeLogFilters(draft);
    if (normalized.error) { setFormError({ key: viewKey, message: normalized.error }); return; }
    setDraftState({ key: viewKey, filters: normalized.filters }); setFormError(null);
    navigate(normalized.filters);
  };
  const resetFilters = () => {
    if (!isCurrentView()) return;
    setDraftState({ key: viewKey, filters: emptyLogFilters }); setFormError(null);
    navigate(emptyLogFilters);
  };

  const getActionBadge = (action: string) => {
    const actionColors: Record<string, string> = {
      'LOGIN': 'bg-blue-100 text-blue-700',
      'CREATE_PRODUCT': 'bg-green-100 text-green-700',
      'UPDATE_PRODUCT': 'bg-yellow-100 text-yellow-700',
      'DELETE_PRODUCT': 'bg-red-100 text-red-700',
      'UPDATE_PRODUCT_STATUS': 'bg-purple-100 text-purple-700',
      'UPDATE_ORDER_STATUS': 'bg-indigo-100 text-indigo-700',
      'UPDATE_USER_STATUS': 'bg-orange-100 text-orange-700'
    };
    
    const colorClass = actionColors[action] || 'bg-gray-100 text-gray-700';
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>{t(Object.hasOwn(logActionLabels, action) ? logActionLabels[action] : action)}</span>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("操作日志")}</h1>
          <p className="text-gray-600 mt-1">{t("查看管理员的所有操作记录")}</p>
        </div>

        <form onSubmit={applyFilters} className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium">{t('操作类型')}
              <select className="input mt-1" value={draft.action} disabled={!searchParams || !sessionId || !ownsFilters} onChange={event => changeDraft('action', event.target.value)}>
                <option value="">{t('全部操作')}</option>
                {draft.action && !Object.hasOwn(logActionLabels, draft.action) && <option value={draft.action}>{draft.action}</option>}
                {Object.entries(logActionLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">{t('管理员编号')}
              <input className="input mt-1" value={draft.adminId} inputMode="numeric" disabled={!searchParams || !sessionId || !ownsFilters} onChange={event => changeDraft('adminId', event.target.value)} />
            </label>
            {(['startDate', 'endDate'] as const).map(key => <label key={key} className="text-sm font-medium">{t(key === 'startDate' ? '开始日期' : '结束日期')}
              <input type="date" className="input mt-1" value={draft[key]} disabled={!searchParams || !sessionId || !ownsFilters} onChange={event => changeDraft(key, event.target.value)} />
            </label>)}
          </div>
          {(applied.error || (formError?.key === viewKey && formError.message)) && <p role="alert" className="text-sm text-red-600">{t(applied.error || formError!.message)}</p>}
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary" disabled={!searchParams || !sessionId || !ownsFilters}>{t('筛选')}</button>
            <button type="button" onClick={resetFilters} className="btn btn-outline" disabled={!searchParams || !sessionId || !ownsFilters}>{t('重置')}</button>
          </div>
        </form>

        {/* 日志列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {applied.error ? null : loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">{t("加载中...")}</p>
              </div>
            </div>
          ) : error ? (
            <div role="alert" className="p-8 text-center">
              <p className="text-red-600">{t(error)}</p>
              <button
                onClick={() => { if (isCurrentView()) void query.refetch(); }}
                className="mt-4 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                {t('重新加载')}
              </button>
            </div>
          ) : (
            <>
              {logs.length === 0 && <p className="p-8 text-center text-gray-600">{t('暂无操作日志')}</p>}
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("操作人")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("操作类型")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("描述")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("IP地址")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("时间")}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <tr key={log.log_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {log.real_name || log.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getActionBadge(log.action)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {log.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.ip_address || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(log.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {/* 分页 */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {t("共 {count} 条记录", { count: total })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => changePage(Math.max(1, Math.min(page - 1, Math.ceil(total / 20))))}
                    disabled={page === 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    {t("上一页")}
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-700">
                    {t("第 {page} 页", { page })}
                  </span>
                  <button
                    onClick={() => changePage(page + 1)}
                    disabled={page >= Math.min(10000, Math.ceil(total / 20))}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    {t("下一页")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
