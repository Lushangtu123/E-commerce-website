'use client';

import '@/lib/admin-i18n';
import { useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import type { AdminPage, AdminUserRow } from '@/lib/api';
import { useAdminQuery, useAdminSessionId } from '@/hooks/use-admin-query';
import AdminLayout from '@/components/AdminLayout';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';

export default function AdminUsersPage() {
  const { t, formatDate } = useI18n();
  const sessionId = useAdminSessionId();
  // The page and filters belong to the administrator who chose them; another one starts unfiltered on page one.
  const [view, setView] = useState({ sessionId, page: 1, filters: { keyword: '', status: '' } });
  const ownsView = view.sessionId === sessionId;
  const page = ownsView ? view.page : 1;
  const filters = ownsView ? view.filters : { keyword: '', status: '' };
  const scopeKey = JSON.stringify([sessionId, page, filters.keyword, filters.status]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mutation = useRef<object | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const query = useAdminQuery({
    name: 'users',
    params: [page, filters.keyword, filters.status],
    load: () => api.get<unknown, AdminPage & { users?: AdminUserRow[] }>('/admin/users', { params: {
      page, limit: 20,
      ...(filters.keyword && { keyword: filters.keyword }),
      ...(filters.status !== '' && { status: filters.status }),
    } }),
  });
  const lastPage = Math.max(1, Number(query.data?.pagination?.totalPages) || Math.ceil((Number(query.data?.pagination?.total) || 0) / 20));
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  // Handlers act only on the rows they were rendered with, not on rows a refresh has since replaced.
  const displayed = useRef(shown);
  displayed.current = shown;
  const users = shown?.users || [];
  const total = Number(shown?.pagination?.total) || 0;
  const loadError = query.error ? requestFailure(query.error).response?.data?.error || '获取用户列表失败' : undefined;
  const loading = !shown && !loadError;
  const busy = !!sessionId && pendingSessionId === sessionId;
  const isCurrentScope = () => query.isCurrentSession() && currentScope.current === scopeKey;
  const isDisplayedScope = () => isCurrentScope() && shown !== undefined && displayed.current === shown;
  const reload = () => { if (isCurrentScope()) void query.refetch(); };

  // A pending action belongs to the administrator who started it; the next one may act at once.
  useEffect(() => {
    mutation.current = null;
    setPendingSessionId(null);
  }, [sessionId]);

  // Disabling the only user on the final filtered page leaves that page empty; show the new last page.
  useEffect(() => {
    if (beyondLastPage) setView({ sessionId, page: lastPage, filters });
  }, [beyondLastPage]);

  useEffect(() => {
    if (query.error) logger.error('获取用户列表失败:', query.error);
  }, [query.error]);

  const runMutation = async (perform: () => Promise<unknown>, success: string, failure: string) => {
    if (!isDisplayedScope() || mutation.current) return;
    const operation = {};
    mutation.current = operation;
    setPendingSessionId(sessionId);
    try {
      await perform();
      if (isDisplayedScope()) toast.success(t(success));
      // The page or filters may have changed meanwhile; this reloads whichever rows are displayed now.
      // After a session change it sends nothing: the old administrator's queries are gone or fail their session check.
      await query.invalidate();
    } catch (error) {
      if (isDisplayedScope()) toast.error(t(requestFailure(error).response?.data?.error || failure));
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setPendingSessionId(null);
      }
    }
  };

  const changeFilters = (next: { keyword: string; status: string }) => {
    if (!isCurrentScope() || (page === 1 && next.keyword === filters.keyword && next.status === filters.status)) return;
    // Retire this scope's handlers now, before React commits the new query.
    currentScope.current = JSON.stringify([sessionId, 1, next.keyword, next.status]);
    setView({ sessionId, page: 1, filters: next });
  };

  const changePage = (next: number) => {
    if (!isDisplayedScope()) return;
    const target = Math.max(1, Math.min(next, Math.max(1, Math.ceil(total / 20))));
    if (target === page) return;
    currentScope.current = JSON.stringify([sessionId, target, filters.keyword, filters.status]);
    setView({ sessionId, page: target, filters });
  };

  const handleStatusChange = (userId: number, newStatus: number) => {
    if (!users.some(row => row.user_id === userId)) return;
    return runMutation(() => api.put(`/admin/users/${userId}/status`, { status: newStatus }),
      newStatus === 1 ? '用户已启用' : '用户已禁用', '更新状态失败');
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("用户管理")}</h1>
          <p className="text-gray-600 mt-1">{t("查看和管理所有用户")}</p>
        </div>

        {/* 搜索和筛选 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder={t("搜索用户名、邮箱、手机号...")}
              aria-label={t("搜索用户")}
              value={filters.keyword}
              onChange={(e) => changeFilters({ ...filters, keyword: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <select
              aria-label={t("用户状态")}
              value={filters.status}
              onChange={(e) => changeFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">{t("全部状态")}</option>
              <option value="1">{t("正常")}</option>
              <option value="0">{t("已禁用")}</option>
            </select>
            <button
              onClick={reload}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {t("搜索")}
            </button>
            <button
              onClick={() => changeFilters({ keyword: '', status: '' })}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {t("重置")}
            </button>
          </div>
        </div>

        {/* 用户列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">{t("加载中...")}</p>
              </div>
            </div>
          ) : loadError ? (
            <div role="alert" className="p-8 text-center">
              <p className="text-red-600">{t(loadError)}</p>
              <button onClick={reload} className="mt-4 px-4 py-2 border rounded-lg">{t('重新加载')}</button>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("用户名")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("邮箱")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("手机号")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("订单数")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("消费金额")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("状态")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("注册时间")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("操作")}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user.user_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {user.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.email || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.phone || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.order_count || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        ¥{(user.total_spent ? Number(user.total_spent) : 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.status === 1 ? (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">{t("正常")}</span>
                        ) : (
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">{t("已禁用")}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(user.created_at, true)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {user.status === 1 ? (
                          <button
                            onClick={() => handleStatusChange(user.user_id, 0)}
                            disabled={busy}
                            className="text-red-600 hover:text-red-900"
                          >
                            {t("禁用")}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(user.user_id, 1)}
                            disabled={busy}
                            className="text-green-600 hover:text-green-900"
                          >
                            {t("启用")}
                          </button>
                        )}
                        <button className="text-primary-600 hover:text-primary-800">
                          {t("详情")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 分页 */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {t("共 {count} 个用户", { count: total })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => changePage(page - 1)}
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
                    disabled={page >= Math.ceil(total / 20)}
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
