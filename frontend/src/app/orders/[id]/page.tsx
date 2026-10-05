'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { orderApi, orderTimeoutApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';
import OrderReviews from '@/components/OrderReviews';
import OrderAfterSales from '@/components/OrderAfterSales';
import { usePaymentSettings } from '@/hooks/use-payment-settings';

const ORDER_STATUS = {
  0: { text: '待支付', color: 'text-orange-600' },
  1: { text: '已支付', color: 'text-blue-600' },
  2: { text: '已发货', color: 'text-green-600' },
  3: { text: '已完成', color: 'text-gray-600' },
  4: { text: '已取消', color: 'text-red-600' },
};

export default function OrderDetailPage() {
  const params = useParams() || {};
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const payments = usePaymentSettings(isHydrated && isAuthenticated);

  const orderId = parseInt(params.id as string);
  const sessionKey = JSON.stringify([token, user?.user_id, orderId]);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const isCurrentSession = () => {
    const current = useAuthStore.getState();
    return mounted.current && currentSession.current === sessionKey && current.isAuthenticated &&
      current.token === token && current.user?.user_id === user?.user_id && localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; detailRequest.current++; };
  }, []);

  useEffect(() => {
    setOrder(null);
    setItems([]);
    setRemainingTime(null);
    actionLock.current = false;
    setActionPending(false);
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadOrder();
  }, [isHydrated, isAuthenticated, token, user?.user_id, orderId, router]);

  useEffect(() => {
    if (isHydrated && isAuthenticated && loadedKey === sessionKey && order?.status === 0) {
      let active = true;
      const refresh = () => loadRemainingTime(() => active);
      refresh();
      const interval = setInterval(refresh, 60000);
      return () => { active = false; clearInterval(interval); };
    }
  }, [isHydrated, isAuthenticated, token, user?.user_id, orderId, loadedKey, order?.status]);

  const loadOrder = async () => {
    if (!isCurrentSession()) return;
    const request = ++detailRequest.current;
    try {
      setLoading(true);
      const data: any = await orderApi.getDetail(orderId);
      if (!isCurrentSession() || request !== detailRequest.current) return;
      setOrder(data.order);
      setItems(data.items || []);
      setLoadedKey(sessionKey);
    } catch (error: any) {
      if (!isCurrentSession() || request !== detailRequest.current) return;
      logger.error('加载订单失败:', error);
      toast.error(t('订单不存在'));
      router.push('/orders');
    } finally {
      if (isCurrentSession() && request === detailRequest.current) setLoading(false);
    }
  };

  const loadRemainingTime = async (isActive: () => boolean) => {
    if (!isActive() || !isCurrentSession()) return;
    try {
      const data: any = await orderTimeoutApi.getRemainingTime(orderId);
      if (!isActive() || !isCurrentSession()) return;
      setRemainingTime(data.remaining_minutes);
      
      // 如果剩余时间为0，刷新订单状态
      if (data.remaining_minutes === 0) {
        loadOrder();
      }
    } catch (error: any) {
      if (!isActive() || !isCurrentSession()) return;
      logger.error('加载剩余时间失败:', error);
    }
  };

  const handlePay = async () => {
    if (!isCurrentSession() || !payments.canPay || actionLock.current || order?.status !== 0) return;
    actionLock.current = true; setActionPending(true);
    try {
      await orderApi.pay(orderId);
      if (!isCurrentSession()) return;
      toast.success(t('模拟支付完成，未实际扣款'));
      loadOrder();
    } catch (error: any) {
      if (!isCurrentSession()) return;
      toast.error(t(error.response?.data?.error || '支付失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  const handleCancel = async () => {
    if (!isCurrentSession() || actionLock.current || order?.status !== 0) return;
    if (!confirm(t('确定要取消订单吗？'))) return;
    if (!isCurrentSession() || actionLock.current) return;
    actionLock.current = true; setActionPending(true);

    try {
      await orderApi.cancel(orderId);
      if (!isCurrentSession()) return;
      toast.success(t('订单已取消'));
      loadOrder();
    } catch (error: any) {
      if (!isCurrentSession()) return;
      toast.error(t(error.response?.data?.error || '取消失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  const handleConfirm = async () => {
    if (!isCurrentSession() || actionLock.current || order?.status !== 2) return;
    actionLock.current = true; setActionPending(true);
    try {
      await orderApi.confirm(orderId);
      if (!isCurrentSession()) return;
      toast.success(t('确认收货成功'));
      loadOrder();
    } catch (error: any) {
      if (!isCurrentSession()) return;
      toast.error(t(error.response?.data?.error || '确认收货失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  if (!isHydrated || !isAuthenticated || loading || loadedKey !== sessionKey) {
    return (
      <div className="py-8">
        <div className="container-custom">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-300 rounded w-1/4"></div>
            <div className="card p-6">
              <div className="h-32 bg-gray-300 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return null;
  }

  return (
    <div className="py-8">
      <div className="container-custom max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">{t("订单详情")}</h1>
        {order.payment_method === 'demo' ? <p role="status" className="mb-6 rounded-lg bg-amber-50 p-4 text-amber-900">{t('演示订单，未实际扣款')}</p> : order.status === 0 && <p role="status" className="mb-6 rounded-lg bg-amber-50 p-4 text-amber-900">{t(payments.loading ? '正在确认支付服务...' : payments.isDemo ? '当前为演示支付，不会实际扣款' : '暂未开通在线支付，请勿向任何个人转账')}</p>}

        {/* 订单状态 */}
        <div className="card p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-gray-600 mb-2">{t("订单状态")}</div>
              <div className={`text-2xl font-bold ${ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].color}`}>
                {t(ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].text)}
              </div>
              {order.status === 0 && remainingTime !== null && remainingTime > 0 && (
                <div className="mt-2 text-orange-600 text-sm">
                  {t('⏰ 剩余支付时间: {minutes} 分钟', { minutes: remainingTime })}
                </div>
              )}
              {order.status === 0 && remainingTime === 0 && (
                <div className="mt-2 text-red-600 text-sm">
                  {t("⚠️ 订单已超时，即将自动取消")}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-gray-600 mb-2">{t("订单号")}</div>
              <div className="font-mono">{order.order_no}</div>
            </div>
          </div>
        </div>

        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">{t("收货信息")}</h2>
          {order.shipping_address_snapshot ? <div>
            <p className="font-medium">{order.shipping_address_snapshot.receiver_name} <span className="ml-2 text-gray-600">{order.shipping_address_snapshot.phone}</span></p>
            <p className="text-gray-600 mt-2">{order.shipping_address_snapshot.province}{order.shipping_address_snapshot.city}{order.shipping_address_snapshot.district}{order.shipping_address_snapshot.detail_address}</p>
          </div> : <p className="text-gray-500">{t("历史订单未记录收货信息")}</p>}
        </div>

        {/* 商品列表 */}
        {(order.status === 2 || order.status === 3 || order.shipping_company || order.tracking_number) && <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">{t('物流信息')}</h2>
          {order.shipping_company && order.tracking_number ? <dl className="space-y-2 text-gray-600"><div><dt className="inline font-medium">{t('快递公司')}：</dt><dd className="inline">{order.shipping_company}</dd></div><div><dt className="inline font-medium">{t('运单号')}：</dt><dd className="inline font-mono break-all">{order.tracking_number}</dd></div></dl> : <p className="text-gray-500">{t('历史订单未记录物流信息')}</p>}
          <p className="mt-3 text-sm text-gray-500">{t('请使用快递公司官方渠道查询物流')}</p>
        </div>}
        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">{t("商品信息")}</h2>
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.item_id} className="flex items-center space-x-4 pb-4 border-b last:border-0">
                <div className="w-20 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                  {item.product_image ? (
                    <img
                      src={item.product_image}
                      alt={item.product_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                      {t("无图")}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">{item.product_name}</h3>
                  {item.sku_specs && <p className="text-gray-600 text-sm mt-1">{Object.entries(item.sku_specs).map(([name, value]) => `${name}: ${value}`).join(' / ')}</p>}
                  {item.sku_code && <p className="text-gray-500 text-xs mt-1">{t("规格编号：")}{item.sku_code}</p>}
                  <p className="text-gray-600 text-sm mt-1">¥{item.price} × {item.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">¥{(item.price * item.quantity).toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 订单金额 */}
        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">{t("订单金额")}</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-gray-600">
              <span>{t("商品总价")}</span>
              <span>¥{Number(order.original_amount ?? order.total_amount).toFixed(2)}</span>
            </div>
            {order.user_coupon_id && (
              <div className="flex justify-between text-gray-600">
                <span>{t("优惠券")}</span>
                <span>{order.coupon_name || t('优惠券')}{order.coupon_code && ` (${order.coupon_code})`}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>{t("优惠券优惠")}</span>
              <span>-¥{Number(order.discount_amount ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>{t("运费")}</span>
              <span className="text-green-600">{t("免运费")}</span>
            </div>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="font-medium">{order.status === 0 || order.status === 4 ? t('应付金额') : t('实付款')}</span>
              <span className="text-2xl font-bold text-primary-600">
                ¥{Number(order.total_amount).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* 时间信息 */}
        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">{t("订单时间")}</h2>
          <div className="space-y-2 text-gray-600">
            <div className="flex justify-between">
              <span>{t("下单时间")}</span>
              <span>{formatDate(order.created_at)}</span>
            </div>
            {order.paid_at && (
              <div className="flex justify-between">
                <span>{t("支付时间")}</span>
                <span>{formatDate(order.paid_at)}</span>
              </div>
            )}
            {order.shipped_at && (
              <div className="flex justify-between">
                <span>{t("发货时间")}</span>
                <span>{formatDate(order.shipped_at)}</span>
              </div>
            )}
            {order.completed_at && (
              <div className="flex justify-between">
                <span>{t("完成时间")}</span>
                <span>{formatDate(order.completed_at)}</span>
              </div>
            )}
          </div>
        </div>

        {order.status === 3 && <OrderReviews key={sessionKey} orderId={orderId} items={items} />}
        {[1, 2, 3].includes(order.status) && <OrderAfterSales key={sessionKey} orderId={orderId} />}

        {/* 操作按钮 */}
        <div className="flex justify-end space-x-3">
          <button onClick={() => router.push('/orders')} className="btn btn-secondary">
            {t("返回订单列表")}
          </button>

          {order.status === 0 && (
            <>
              {payments.canPay && <button onClick={handlePay} disabled={actionPending} className="btn btn-primary">
                {t("模拟支付")}
              </button>}
              <button onClick={handleCancel} disabled={actionPending} className="btn btn-secondary">
                {t("取消订单")}
              </button>
            </>
          )}

          {order.status === 2 && (
            <button onClick={handleConfirm} disabled={actionPending} className="btn btn-primary">
              {t("确认收货")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
