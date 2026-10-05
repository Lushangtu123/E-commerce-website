'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { FiPackage } from 'react-icons/fi';
import { useI18n } from '@/lib/i18n';
import { usePaymentSettings } from '@/hooks/use-payment-settings';
import { requestFailure } from '@/lib/api-error';

const ORDER_STATUS = {
  0: { text: '待支付', color: 'text-orange-600' },
  1: { text: '已支付', color: 'text-blue-600' },
  2: { text: '已发货', color: 'text-green-600' },
  3: { text: '已完成', color: 'text-gray-600' },
  4: { text: '已取消', color: 'text-red-600' },
};

export default function OrdersPage() {
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const [pageState, setPage] = useState(1);
  const [tabState, setActiveTab] = useState<number | undefined>(undefined);
  const [querySession, setQuerySession] = useState<string | null>(null);
  const [queryReady, setQueryReady] = useState(false);
  const [result, setResult] = useState<{ key: string; orders: any[]; total: number; totalPages: number; error?: string } | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef<object | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const latestRefresh = useRef<(() => Promise<void>) | null>(null);
  const sessionKey = JSON.stringify([token, user?.user_id]);
  // Derive the new account's query before effects run, so neither its rows nor its filters flash from the old account.
  const ownsQuery = querySession === null || querySession === sessionKey;
  const page = ownsQuery ? pageState : 1;
  const activeTab = ownsQuery ? tabState : undefined;
  const scopeKey = JSON.stringify([sessionKey, activeTab, page]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const loading = result?.key !== scopeKey;
  const orders = result?.key === scopeKey ? result.orders : [];
  const total = result?.key === scopeKey ? result.total : 0;
  const totalPages = result?.key === scopeKey ? result.totalPages : 0;
  const loadError = result?.key === scopeKey ? result.error : undefined;
  const isCurrentSession = () => {
    const state = useAuthStore.getState();
    return mounted.current && state.isAuthenticated &&
      state.token === token && state.user?.user_id === user?.user_id && localStorage.getItem('token') === (token ?? null);
  };
  const isCurrentScope = () => isCurrentSession() && currentScope.current === scopeKey;
  const actionsPending = pendingSession === sessionKey;
  const payments = usePaymentSettings(isHydrated && isAuthenticated);

  useEffect(() => {
    mounted.current = true;
    const value = new URLSearchParams(window.location.search).get('status');
    setActiveTab(value !== null && /^[0-4]$/.test(value) ? Number(value) : undefined);
    setQueryReady(true);
    return () => { mounted.current = false; request.current++; };
  }, []);

  useEffect(() => {
    if (!isHydrated || !queryReady) return;
    if (querySession !== null && querySession !== sessionKey) {
      setPage(1);
      setActiveTab(undefined);
      mutation.current = null;
      setPendingSession(null);
    }
    setQuerySession(sessionKey);
  }, [isHydrated, queryReady, sessionKey]);

  useEffect(() => {
    if (!isHydrated || !queryReady) return;
    if (!isAuthenticated) { router.push('/login'); return; }
    loadOrders();
    return () => { request.current++; };
  }, [isHydrated, isAuthenticated, queryReady, scopeKey, router]);

  const loadOrders = async () => {
    if (!isCurrentScope()) return;
    const revision = ++request.current;
    setResult(null);
    try {
      const data: any = await orderApi.list({ page, limit: 10, ...(activeTab !== undefined && { status: activeTab }) });
      if (!isCurrentScope() || revision !== request.current) return;
      if (page > Math.max(1, Number(data.totalPages) || 0)) {
        setPage(Math.max(1, Number(data.totalPages) || 0));
        return;
      }
      setResult({ key: scopeKey, orders: data.orders || [], total: data.total || 0, totalPages: data.totalPages || 0 });
    } catch (error) {
      if (!isCurrentScope() || revision !== request.current) return;
      logger.error('加载订单失败:', error);
      setResult({ key: scopeKey, orders: [], total: 0, totalPages: 0, error: requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || '加载订单失败，请重试' });
    }
  };

  latestRefresh.current = loadOrders;

  const handleMutation = async (orderId: number, action: 'pay' | 'cancel' | 'confirm') => {
    if (!isCurrentScope() || loading || loadError || mutation.current) return;
    if (action === 'pay' && !payments.canPay) return;
    const order = orders.find(item => item.order_id === orderId);
    if (!order || (action === 'confirm' ? order.status !== 2 : order.status !== 0)) return;
    if (action === 'cancel' && !confirm(t('确定要取消订单吗？'))) return;
    if (!isCurrentScope() || mutation.current) return;
    const operation = {};
    mutation.current = operation;
    setPendingSession(sessionKey);
    try {
      await orderApi[action](orderId);
      if (!isCurrentSession()) return;
      toast.success(t(action === 'pay' ? '模拟支付完成，未实际扣款' : action === 'cancel' ? '订单已取消' : '确认收货成功'));
      await latestRefresh.current?.();
    } catch (error) {
      if (!isCurrentSession()) return;
      toast.error(t(requestFailure(error).response?.data?.error || (action === 'pay' ? '支付失败' : action === 'cancel' ? '取消失败' : '确认收货失败')));
    } finally {
      if (isCurrentSession() && mutation.current === operation) {
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

        {/* 状态筛选 */}
        <div className="card p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => { setActiveTab(undefined); setPage(1); }}
              className={`px-4 py-2 rounded ${
                activeTab === undefined ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("全部")}
            </button>
            <button
              onClick={() => { setActiveTab(0); setPage(1); }}
              className={`px-4 py-2 rounded ${
                activeTab === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("待支付")}
            </button>
            <button
              onClick={() => { setActiveTab(1); setPage(1); }}
              className={`px-4 py-2 rounded ${
                activeTab === 1 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已支付")}
            </button>
            <button
              onClick={() => { setActiveTab(2); setPage(1); }}
              className={`px-4 py-2 rounded ${
                activeTab === 2 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已发货")}
            </button>
            <button
              onClick={() => { setActiveTab(3); setPage(1); }}
              className={`px-4 py-2 rounded ${
                activeTab === 3 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              {t("已完成")}
            </button>
            <button onClick={() => { setActiveTab(4); setPage(1); }} className={`px-4 py-2 rounded-sm ${activeTab === 4 ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>{t("已取消")}</button>
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
            <button onClick={loadOrders} className="btn btn-secondary mt-4">{t("重新加载")}</button>
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
                    <span className="text-gray-400">
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
                        disabled={actionsPending}
                        className="btn btn-primary"
                      >
                        {t("模拟支付")}
                      </button>}
                      <button
                        onClick={() => handleMutation(order.order_id, 'cancel')}
                        disabled={actionsPending}
                        className="btn btn-secondary"
                      >
                        {t("取消订单")}
                      </button>
                    </>
                  )}

                  {order.status === 2 && (
                    <button
                      onClick={() => handleMutation(order.order_id, 'confirm')}
                      disabled={actionsPending}
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
            <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="btn btn-secondary disabled:opacity-50">{t("上一页")}</button>
            <span>{t('第 {page} / {total} 页', { page, total: Math.max(1, totalPages) })}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)} className="btn btn-secondary disabled:opacity-50">{t("下一页")}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
