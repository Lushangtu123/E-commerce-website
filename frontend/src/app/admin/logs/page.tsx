'use client';

import { useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { logger } from '@/lib/logger';
import api from '@/lib/api';
import { ADMIN_SESSION_EVENT, getAdminSessionToken } from '@/lib/admin-session';

export default function AdminLogsPage() {
  const { t, formatDate } = useI18n();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [sessionToken, setSessionToken] = useState<string | null>(() => getAdminSessionToken());
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const mounted = useRef(false);
  const requestId = useRef(0);
  const tokenRef = useRef(sessionToken);
  const queryRef = useRef({ sessionToken, page, retry });
  tokenRef.current = sessionToken;
  queryRef.current = { sessionToken, page, retry };

  useEffect(() => {
    mounted.current = true;
    const syncSession = () => {
      if (!mounted.current) return;
      const next = getAdminSessionToken();
      if (next === tokenRef.current) return;
      tokenRef.current = next;
      requestId.current += 1;
      setSessionToken(next);
      setPage(1);
      setLogs([]);
      setTotal(0);
      setError(null);
      setLoadedKey(null);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'admin_token' || event.key === 'admin_user') syncSession();
    };
    syncSession();
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_SESSION_EVENT, syncSession);
    return () => {
      mounted.current = false;
      requestId.current += 1;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_SESSION_EVENT, syncSession);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const id = ++requestId.current;
    const key = `${sessionToken}:${page}`;
    const isCurrent = () => active && mounted.current && id === requestId.current && !!sessionToken && getAdminSessionToken() === sessionToken;
    setLoading(true);
    setError(null);
    setLoadedKey(null);
    if (!isCurrent()) return () => { active = false; };
    const fetchLogs = async () => {
      try {
        const data = await api.get<any, { logs: any[]; pagination: { total: number } }>('/admin/logs', { params: { page, limit: 20 } });
        if (!isCurrent()) return;
        setLogs(data.logs);
        setTotal(data.pagination.total);
        setLoadedKey(key);
      } catch (error: any) {
        if (!isCurrent()) return;
        logger.error('获取日志失败:', error);
        setLogs([]);
        setTotal(0);
        setError(error?.response?.data?.error || error?.message || '获取日志失败');
        setLoadedKey(key);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };
    void fetchLogs();
    return () => { active = false; };
  }, [sessionToken, page, retry]);

  const resultCurrent = !!sessionToken && getAdminSessionToken() === sessionToken && loadedKey === `${sessionToken}:${page}`;
  const isCurrentView = () => mounted.current && queryRef.current.sessionToken === sessionToken && queryRef.current.page === page && queryRef.current.retry === retry && getAdminSessionToken() === sessionToken;
  const changePage = (next: number) => {
    if (!isCurrentView() || !resultCurrent || error || loading) return;
    requestId.current += 1;
    setPage(next);
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
    const actionColors: any = {
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
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading || !resultCurrent ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">{t("加载中...")}</p>
              </div>
            </div>
          ) : error ? (
            <div role="alert" className="p-8 text-center">
              <p className="text-red-600">{t(error)}</p>
              <button
                onClick={() => {
                  if (isCurrentView()) {
                    requestId.current += 1;
                    setRetry(value => value + 1);
                  }
                }}
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
