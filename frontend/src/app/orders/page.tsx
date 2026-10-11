'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { orderApi, type Order } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { FiPackage } from 'react-icons/fi';
import { translate, useI18n } from '@/lib/i18n';
import { usePaymentSettings } from '@/hooks/use-payment-settings';
import { requestFailure } from '@/lib/api-error';
import { useSessionQuery } from '@/hooks/use-session-query';
import { confirmAction } from '@/lib/confirm';
import { customerOrderSnapshot, customerOrderCheckMessage, customerOrderTarget, validCustomerOrder, validCustomerOrderAcknowledgement, uncertainCustomerOrderWrite, type CustomerOrderAction } from '@/lib/customer-order-recovery';

type Recovery = { key: string; order: Order; action: CustomerOrderAction; checking: boolean };

const ORDER_STATUS = {
  0: { text: '待支付', color: 'text-orange-600' },
  1: { text: '已支付', color: 'text-blue-600' },
  2: { text: '已发货', color: 'text-green-600' },
  3: { text: '已完成', color: 'text-gray-600' },
  4: { text: '已取消', color: 'text-red-600' },
};

export default function OrdersPage() {
  const { t } = useI18n();
  return <Suspense fallback={<div className="py-8 text-center text-gray-600">{t('加载中...')}</div>}><OrdersContent /></Suspense>;
}

function OrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlKey = searchParams?.toString() || '';
  const statuses = searchParams?.getAll('status') || [];
  const urlStatus = statuses.length === 1 && statuses[0].length === 1 && /^[0-4]$/.test(statuses[0]) ? Number(statuses[0]) : undefined;
  const { t, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  // The URL owns status; pagination belongs to this URL and session. The first session claims a deep link.
  const [filters, setFilters] = useState<{ session: string | null; urlKey: string; page: number }>({ session: null, urlKey, page: 1 });
  const ownsFilters = filters.session === null || filters.session === sessionKey;
  if ((ownsFilters && filters.urlKey !== urlKey) || (!ownsFilters && isHydrated && statuses.length === 0)) {
    setFilters({ session: ownsFilters ? filters.session : sessionKey, urlKey, page: 1 });
  }
  const page = ownsFilters && filters.urlKey === urlKey ? filters.page : 1;
  const activeTab = ownsFilters ? urlStatus : undefined;
  const setPage = (next: number) => {
    if (isCurrentScope()) setFilters({ session: sessionKey, urlKey, page: next });
  };
  const setActiveTab = (tab?: number) => {
    if (!isCurrentScope()) return;
    const params = new URLSearchParams(urlKey);
    if (tab === undefined) params.delete('status');
    else params.set('status', String(tab));
    const next = params.toString();
    if (next !== urlKey) window.history.pushState(null, '', `/orders${next ? `?${next}` : ''}`);
  };
  const scopeKey = JSON.stringify([sessionKey, activeTab, page, urlKey]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mutation = useRef<object | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const recovery = useRef(new Map<number, Recovery>());
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const confirmed = useRef(new Map<number, { key: string; before: number; order: Order }>());
  const queryClient = useQueryClient();
  const query = useSessionQuery({
    name: 'orders',
    params: [activeTab ?? 'all', page],
    load: async () => {
      const data = await orderApi.list({ page, limit: 10, ...(activeTab !== undefined && { status: activeTab }) });
      if (!data || !Array.isArray(data.orders) || !data.orders.every(validCustomerOrder)) throw new Error('Invalid order list');
      return data;
    },
  });
  const { isCurrentSession } = query;
  const lastPage = Math.max(1, Number(query.data?.totalPages) || 0);
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  const loadError = query.error
    ? requestFailure(query.error).response?.data?.error || requestFailure(query.error).response?.data?.message || '加载订单失败，请重试'
    : undefined;
  const loading = !shown && !loadError;
  // An authoritative detail check takes precedence over lagging list rows from before the write.
  const checkedOrders = (shown?.orders || []).map(order => {
    const checked = confirmed.current.get(order.order_id);
    return checked?.key === sessionKey && order.status === checked.before ? { ...order, ...checked.order } : order;
  });
  const orders = activeTab === undefined ? checkedOrders : checkedOrders.filter(order => order.status === activeTab);
  const total = Math.max(0, (shown?.total || 0) - (checkedOrders.length - orders.length));
  const totalPages = shown?.totalPages || 0;
  const isCurrentScope = () => isCurrentSession() && currentScope.current === scopeKey &&
    new URLSearchParams(window.location.search).toString() === urlKey;
  const actionsPending = pendingSession === sessionKey;
  const unresolved = recoveries.filter(record => record.key === sessionKey && isCurrentSession());
  const payments = usePaymentSettings(isHydrated && isAuthenticated);
  const refreshOrders = async () => {
    if (!isCurrentSession()) return;
    // Cancel a pre-write GET even when it has not returned any data yet, then request a fresh snapshot.
    await queryClient.cancelQueries({ queryKey: ['orders', sessionId, user?.user_id] });
    if (isCurrentSession()) await query.invalidate();
  };

  useEffect(() => {
    if (!isHydrated) return;
    if (filters.session === null) setFilters({ ...filters, session: sessionKey });
    else if (filters.session !== sessionKey) {
      const params = new URLSearchParams(window.location.search);
      params.delete('status');
      const next = params.toString();
      // Wait for useSearchParams to observe this replacement before the next account claims the URL.
      window.history.replaceState(null, '', `/orders${next ? `?${next}` : ''}`);
    }
  }, [isHydrated, filters, sessionKey]);

  // A pending action belongs to the session that started it; the next session may act at once.
  useEffect(() => {
    mutation.current = null;
    setPendingSession(null);
    recovery.current.clear(); confirmed.current.clear(); setRecoveries([]);
  }, [sessionKey]);

  // Cancelling the only order on the final page leaves that page empty; show the new last page.
  useEffect(() => {
    if (beyondLastPage) setPage(lastPage);
  }, [beyondLastPage]);

  useEffect(() => {
    if (query.error) logger.error('加载订单失败:', query.error);
  }, [query.error]);

  useEffect(() => {
    if (isHydrated && !isAuthenticated) router.push('/login');
  }, [isHydrated, isAuthenticated, router]);

  const syncRecovery = () => setRecoveries(Array.from(recovery.current.values()));
  const checkOrder = async (record: Recovery) => {
    const id = record.order.order_id;
    if (!isCurrentSession() || record.key !== sessionKey || recovery.current.get(id) !== record || record.checking) return;
    record.checking = true; syncRecovery();
    try {
      const data = await orderApi.getDetail(id);
      if (!isCurrentSession() || recovery.current.get(id) !== record) return;
      const actual = customerOrderSnapshot(data, id);
      if (!actual) throw new Error('Invalid order detail');
      confirmed.current.set(id, { key: sessionKey, before: record.order.status, order: actual.order });
      toast[actual.order.status === customerOrderTarget[record.action] ? 'success' : 'error'](translate(customerOrderCheckMessage(record.order.status, actual.order.status, record.action)));
      await refreshOrders();
      if (!isCurrentSession() || recovery.current.get(id) !== record) return;
      recovery.current.delete(id); syncRecovery();
    } catch {
      if (isCurrentSession() && recovery.current.get(id) === record) { record.checking = false; syncRecovery(); }
    }
  };

  const handleMutation = async (orderId: number, action: CustomerOrderAction) => {
    if (!isCurrentScope() || mutation.current || loading || loadError || recovery.current.get(orderId)?.key === sessionKey) return;
    if (action === 'pay' && !payments.canPay) return;
    const order = orders.find(item => item.order_id === orderId);
    if (!order || (action === 'confirm' ? order.status !== 2 : order.status !== 0)) return;
    if (action === 'cancel' && !(await confirmAction(t('确定要取消订单吗？')))) return;
    if (!isCurrentScope() || mutation.current || recovery.current.get(orderId)?.key === sessionKey) return;
    const operation = {};
    mutation.current = operation;
    setPendingSession(sessionKey);
    try {
      const receipt = await orderApi[action](orderId);
      if (!isCurrentSession()) return;
      if (!validCustomerOrderAcknowledgement(receipt, action)) throw new Error('Invalid order action acknowledgement');
      toast.success(translate(action === 'pay' ? '模拟支付完成，未实际扣款' : action === 'cancel' ? '订单已取消' : '确认收货成功'));
      // The filter or page may have changed meanwhile; this reloads whichever orders are displayed now.
      await refreshOrders();
    } catch (error) {
      if (!isCurrentSession()) return;
      if (uncertainCustomerOrderWrite(error)) {
        const record: Recovery = { key: sessionKey, order, action, checking: false };
        recovery.current.set(orderId, record); syncRecovery(); await checkOrder(record);
      } else toast.error(translate(requestFailure(error).response?.data?.error || (action === 'pay' ? '支付失败' : action === 'cancel' ? '取消失败' : '确认收货失败')));
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setPendingSession(null);
      }
    }
  };

  if (!isHydrated || !isAuthenticated) {
    return <div className="py-8 text-center text-gray-600">{t("加载中...")}</div>;
  }

  return (
    <div className="py-8">
      <div className="container-custom">
        <h1 className="text-3xl font-bold mb-8">{t("我的订单")}</h1>
        <p className="mb-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="status">{t(payments.loading ? '正在确认支付服务...' : payments.isDemo ? '当前为演示支付，不会实际扣款' : '暂未开通在线支付，请勿向任何个人转账')}</p>
        {unresolved.map(record => <div key={record.order.order_id} className="card p-6 mb-6" role="alert">
          <p>{record.order.order_no}</p>
          <p>{t(record.checking ? '订单更新结果未知，正在核对实际状态...' : '订单更新结果尚未确认，请重新核对订单；确认前不会再次提交')}</p>
          <button className="btn btn-secondary mt-4" disabled={actionsPending || record.checking} onClick={() => void checkOrder(record)}>{t('重新核对订单')}</button>
        </div>)}

        {/* 状态筛选 */}
        <div className="card p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setActiveTab(undefined)}
              className={`px-4 py-2 rounded ${
                activeTab === undefined ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("全部")}
            </button>
            <button
              onClick={() => setActiveTab(0)}
              className={`px-4 py-2 rounded ${
                activeTab === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("待支付")}
            </button>
            <button
              onClick={() => setActiveTab(1)}
              className={`px-4 py-2 rounded ${
                activeTab === 1 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已支付")}
            </button>
            <button
              onClick={() => setActiveTab(2)}
              className={`px-4 py-2 rounded ${
                activeTab === 2 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已发货")}
            </button>
            <button
              onClick={() => setActiveTab(3)}
              className={`px-4 py-2 rounded ${
                activeTab === 3 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已完成")}
            </button>
            <button onClick={() => setActiveTab(4)} className={`px-4 py-2 rounded-sm ${activeTab === 4 ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>{t("已取消")}</button>
          </div>
        </div>

        {/* 订单列表 */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-6 animate-pulse">
                <div className="h-6 bg-gray-300 rounded-sm w-1/4 mb-4"></div>
                <div className="h-24 bg-gray-300 rounded-sm"></div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="card p-6 text-center" role="alert">
            <p className="text-red-600">{t(loadError)}</p>
            <button onClick={query.refetch} className="btn btn-secondary mt-4">{t("重新加载")}</button>
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <FiPackage className="h-7 w-7" aria-hidden="true" />
            </span>
            <h3 className="mb-1 text-lg font-medium text-gray-900">{t("暂无订单")}</h3>
            <p className="mb-6 text-sm text-gray-500">{t("快去购物吧")}</p>
            <Link href="/products" className="btn btn-primary">
              {t("去购物")}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.order_id} className="card p-6">
                <div className="flex justify-between items-center mb-4 pb-4 border-b">
                  <div className="flex items-center space-x-4">
                    <span className="text-gray-600">{t("订单号:")} {order.order_no}</span>
                    <span className="text-gray-500">
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                  <span className={`font-medium ${ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].color}`}>
                    {t(ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].text)}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">{t("订单金额")}</span>
                    <span className="text-2xl font-bold text-primary-600">
                      ¥{order.total_amount}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <Link
                    href={`/orders/${order.order_id}`}
                    className="btn btn-secondary"
                  >
                    {t("查看详情")}
                  </Link>
                  
                  {order.status === 0 && (
                    <>
                      {payments.canPay && <button
                        onClick={() => handleMutation(order.order_id, 'pay')}
                        disabled={actionsPending || unresolved.some(record => record.order.order_id === order.order_id)}
                        className="btn btn-primary"
                      >
                        {t("模拟支付")}
                      </button>}
                      <button
                        onClick={() => handleMutation(order.order_id, 'cancel')}
                        disabled={actionsPending || unresolved.some(record => record.order.order_id === order.order_id)}
                        className="btn btn-secondary"
                      >
                        {t("取消订单")}
                      </button>
                    </>
                  )}

                  {order.status === 2 && (
                    <button
                      onClick={() => handleMutation(order.order_id, 'confirm')}
                      disabled={actionsPending || unresolved.some(record => record.order.order_id === order.order_id)}
                      className="btn btn-primary"
                    >
                      {t("确认收货")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && !loadError && <div className="flex justify-between items-center mt-6">
          <p className="text-gray-600">{t('共 {count} 个订单', { count: total })}</p>
          <div className="flex gap-3 items-center">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-secondary disabled:opacity-50">{t("上一页")}</button>
            <span>{t('第 {page} / {total} 页', { page, total: Math.max(1, totalPages) })}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="btn btn-secondary disabled:opacity-50">{t("下一页")}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
