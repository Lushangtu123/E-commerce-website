'use client';

import { useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { logger } from '@/lib/logger';
import api from '@/lib/api';
import type { AdminLog } from '@/lib/api';
import { useAdminQuery, useAdminSessionToken } from '@/hooks/use-admin-query';
import { requestFailure } from '@/lib/api-error';

export default function AdminLogsPage() {
  const { t, formatDate } = useI18n();
  const token = useAdminSessionToken();
  // The page belongs to the administrator who chose it; another administrator starts on page one.
  const [pageState, setPageState] = useState({ token, page: 1 });
  const page = pageState.token === token ? pageState.page : 1;
  const viewKey = JSON.stringify([token, page]);
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  const query = useAdminQuery({
    name: 'logs',
    params: [page],
    load: () => api.get<unknown, { logs: AdminLog[]; pagination: { total: number } }>('/admin/logs', { params: { page, limit: 20 } }),
  });
  const logs = query.data?.logs ?? [];
  const total = query.data?.pagination.total ?? 0;
  const error = query.error
    ? requestFailure(query.error).response?.data?.error || requestFailure(query.error).message || '获取日志失败'
    : undefined;
  const loading = !query.data && !error;
  const isCurrentView = () => query.isCurrentSession() && currentView.current === viewKey;

  useEffect(() => {
    if (query.error) logger.error('获取日志失败:', query.error);
  }, [query.error]);

  const changePage = (next: number) => {
    if (!isCurrentView() || !query.data) return;
    setPageState({ token, page: next });
  };

  const getActionBadge = (action: string) => {
    const actionLabels: Record<string, string> = {
      LOGIN: '登录',
      CREATE_PRODUCT: '创建商品',
      UPDATE_PRODUCT: '更新商品',
      DELETE_PRODUCT: '删除商品',
      UPDATE_PRODUCT_STATUS: '更新商品状态',
      BATCH_UPDATE_PRODUCT_STATUS: '批量更新商品状态',
      UPDATE_ORDER_STATUS: '更新订单状态',
      UPDATE_USER_STATUS: '更新用户状态',
      CREATE_COUPON: '创建优惠券',
      UPDATE_COUPON: '更新优惠券',
      UPDATE_COUPON_STATUS: '更新优惠券状态',
      CREATE_SKU: '创建SKU',
      BATCH_CREATE_SKU: '批量创建SKU',
      UPDATE_SKU: '更新SKU',
      DELETE_SKU: '删除SKU',
    };
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
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>{t(actionLabels[action] || action)}</span>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("操作日志")}</h1>
          <p className="text-gray-600 mt-1">{t("查看管理员的所有操作记录")}</p>
        </div>

        {/* 日志列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
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

              {/* 分页 */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {t("共 {count} 条记录", { count: total })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => changePage(Math.max(1, page - 1))}
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
