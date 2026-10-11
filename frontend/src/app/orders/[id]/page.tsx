'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { orderApi, orderTimeoutApi, type Order, type OrderItem } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { FiAlertTriangle, FiClock } from 'react-icons/fi';
import ProductImage from '@/components/ProductImage';
import { translate, useI18n } from '@/lib/i18n';
import { localizedText, specSummary } from '@/lib/product-content';
import OrderReviews from '@/components/OrderReviews';
import OrderAfterSales from '@/components/OrderAfterSales';
import { usePaymentSettings } from '@/hooks/use-payment-settings';
import { requestFailure } from '@/lib/api-error';
import { confirmAction } from '@/lib/confirm';
import { customerOrderSnapshot, customerOrderCheckMessage, customerOrderTarget, validCustomerOrderAcknowledgement, uncertainCustomerOrderWrite, type CustomerOrderAction } from '@/lib/customer-order-recovery';

type Recovery = { key: string; before: number; action: CustomerOrderAction; checking: boolean };

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
  const { t, formatDate, locale } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const detailInFlight = useRef<number | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const recovery = useRef<Recovery | null>(null);
  const [recoveryView, setRecoveryView] = useState<Recovery | null>(null);
  const payments = usePaymentSettings(isHydrated && isAuthenticated);

  const rawOrderId = params.id;
  const parsedOrderId = typeof rawOrderId === 'string' ? Number(rawOrderId) : NaN;
  const orderId = Number.isSafeInteger(parsedOrderId) && parsedOrderId > 0 && String(parsedOrderId) === rawOrderId ? parsedOrderId : NaN;
  const sessionKey = JSON.stringify([sessionId, user?.user_id, orderId]);
  const loadError = failure?.key === sessionKey ? failure.message : null;
  const unresolved = recoveryView?.key === sessionKey ? recoveryView : null;
  const actionsBlocked = actionPending || loading || !!loadError || !!unresolved;
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const isCurrentSession = () => {
    const current = useAuthStore.getState();
    return mounted.current && currentSession.current === sessionKey && current.isAuthenticated &&
      current.sessionId === sessionId && current.user?.user_id === user?.user_id && storedSessionId() === (sessionId ?? null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; detailRequest.current++; };
  }, []);

  useEffect(() => {
    setOrder(null);
    setItems([]);
    setRemainingTime(null);
    setLoadedKey(null);
    setFailure(null);
    detailRequest.current++;
    detailInFlight.current = null;
    actionLock.current = false;
    setActionPending(false);
    recovery.current = null;
    setRecoveryView(null);
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!Number.isSafeInteger(orderId)) {
      toast.error(translate('订单ID无效'));
      router.push('/orders');
      return;
    }
    loadOrder();
  }, [isHydrated, isAuthenticated, sessionId, user?.user_id, orderId, router]);

  useEffect(() => {
    if (isHydrated && isAuthenticated && !loadError && !unresolved && loadedKey === sessionKey && order?.status === 0) {
      let active = true;
      const refresh = () => loadRemainingTime(() => active);
      refresh();
      const interval = setInterval(refresh, 60000);
      return () => { active = false; clearInterval(interval); };
    }
  }, [isHydrated, isAuthenticated, sessionId, user?.user_id, orderId, loadedKey, order?.status, loadError, unresolved]);

  const loadOrder = async (afterWrite = false) => {
    if (!isCurrentSession() || recovery.current?.key === sessionKey || (!afterWrite && detailInFlight.current !== null)) return;
    // A successful write needs a new snapshot; any earlier read is now obsolete.
    const request = ++detailRequest.current;
    detailInFlight.current = request;
    try {
      setLoading(true);
      setFailure(null);
      const data = await orderApi.getDetail(orderId);
      if (!isCurrentSession() || request !== detailRequest.current) return;
      const actual = customerOrderSnapshot(data, orderId);
      if (!actual) throw new Error('Invalid order detail');
      setOrder(actual.order);
      setItems(actual.items);
      setLoadedKey(sessionKey);
    } catch (error) {
      if (!isCurrentSession() || request !== detailRequest.current) return;
      logger.error('加载订单失败:', error);
      const response = requestFailure(error).response;
      if (response?.status === 401) return; // The API client handles expired sign-ins.
      if (response?.status === 400 || response?.status === 403 || response?.status === 404) {
        toast.error(translate(response.data?.error || response.data?.message ||
          (response.status === 404 ? '订单不存在' : response.status === 403 ? '无权访问该订单' : '订单ID无效')));
        router.push('/orders');
      } else {
        setFailure({ key: sessionKey, message: '加载订单详情失败，请重试' });
      }
    } finally {
      if (detailInFlight.current === request) detailInFlight.current = null;
      if (isCurrentSession() && request === detailRequest.current) setLoading(false);
    }
  };

  const checkOrder = async (record: Recovery) => {
    if (!isCurrentSession() || recovery.current !== record || record.checking) return;
    record.checking = true;
    setRecoveryView({ ...record });
    // The known snapshot stays visible with locked controls while an obsolete countdown read is retired.
    setLoading(false);
    // Retire countdown or earlier detail reads before reconciling the write.
    const request = ++detailRequest.current;
    detailInFlight.current = request;
    try {
      const data = await orderApi.getDetail(orderId);
      if (!isCurrentSession() || recovery.current !== record || request !== detailRequest.current) return;
      const actual = customerOrderSnapshot(data, orderId);
      if (!actual) throw new Error('Invalid order detail');
      setOrder(actual.order); setItems(actual.items); setLoadedKey(sessionKey); setFailure(null); setLoading(false);
      recovery.current = null; setRecoveryView(null);
      toast[actual.order.status === customerOrderTarget[record.action] ? 'success' : 'error'](translate(customerOrderCheckMessage(record.before, actual.order.status, record.action)));
    } catch {
      if (isCurrentSession() && recovery.current === record && request === detailRequest.current) {
        record.checking = false; setRecoveryView({ ...record });
      }
    } finally {
      if (detailInFlight.current === request) detailInFlight.current = null;
    }
  };

  const recoverWrite = async (action: CustomerOrderAction) => {
    const record: Recovery = { key: sessionKey, before: order!.status, action, checking: false };
    recovery.current = record; setRecoveryView({ ...record });
    await checkOrder(record);
  };

  const loadRemainingTime = async (isActive: () => boolean) => {
    if (!isActive() || !isCurrentSession()) return;
    try {
      const data = await orderTimeoutApi.getRemainingTime(orderId);
      if (!isActive() || !isCurrentSession()) return;
      setRemainingTime(data.remaining_minutes);
      
      // 如果剩余时间为0，刷新订单状态
      if (data.remaining_minutes === 0) {
        loadOrder();
      }
    } catch (error) {
      if (!isActive() || !isCurrentSession()) return;
      logger.error('加载剩余时间失败:', error);
    }
  };

  const handlePay = async () => {
    if (!isCurrentSession() || detailInFlight.current !== null || recovery.current?.key === sessionKey || loadError || !payments.canPay || actionLock.current || order?.status !== 0) return;
    actionLock.current = true; setActionPending(true);
    try {
      const receipt = await orderApi.pay(orderId);
      if (!isCurrentSession()) return;
      if (!validCustomerOrderAcknowledgement(receipt, 'pay')) throw new Error('Invalid order action acknowledgement');
      toast.success(translate('模拟支付完成，未实际扣款'));
      await loadOrder(true);
    } catch (error) {
      if (!isCurrentSession()) return;
      if (uncertainCustomerOrderWrite(error)) await recoverWrite('pay');
      else toast.error(translate(requestFailure(error).response?.data?.error || '支付失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  const handleCancel = async () => {
    if (!isCurrentSession() || detailInFlight.current !== null || recovery.current?.key === sessionKey || loadError || actionLock.current || order?.status !== 0) return;
    if (!(await confirmAction(t('确定要取消订单吗？')))) return;
    if (!isCurrentSession() || detailInFlight.current !== null || recovery.current?.key === sessionKey || loadError || actionLock.current) return;
    actionLock.current = true; setActionPending(true);

    try {
      const receipt = await orderApi.cancel(orderId);
      if (!isCurrentSession()) return;
      if (!validCustomerOrderAcknowledgement(receipt, 'cancel')) throw new Error('Invalid order action acknowledgement');
      toast.success(translate('订单已取消'));
      await loadOrder(true);
    } catch (error) {
      if (!isCurrentSession()) return;
      if (uncertainCustomerOrderWrite(error)) await recoverWrite('cancel');
      else toast.error(translate(requestFailure(error).response?.data?.error || '取消失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  const handleConfirm = async () => {
    if (!isCurrentSession() || detailInFlight.current !== null || recovery.current?.key === sessionKey || loadError || actionLock.current || order?.status !== 2) return;
    actionLock.current = true; setActionPending(true);
    try {
      const receipt = await orderApi.confirm(orderId);
      if (!isCurrentSession()) return;
      if (!validCustomerOrderAcknowledgement(receipt, 'confirm')) throw new Error('Invalid order action acknowledgement');
      toast.success(translate('确认收货成功'));
      await loadOrder(true);
    } catch (error) {
      if (!isCurrentSession()) return;
      if (uncertainCustomerOrderWrite(error)) await recoverWrite('confirm');
      else toast.error(translate(requestFailure(error).response?.data?.error || '确认收货失败'));
    } finally {
      if (isCurrentSession()) { actionLock.current = false; setActionPending(false); }
    }
  };

  const errorNotice = loadError && (
    <div className="card p-6 mb-6 text-center" role="alert">
      <p className="text-red-600">{t(loadError)}</p>
      <button onClick={() => loadOrder()} disabled={loading} className="btn btn-secondary mt-4">{t('重新加载')}</button>
    </div>
  );

  if (isHydrated && isAuthenticated && !loading && loadError && loadedKey !== sessionKey) {
    return <div className="py-8"><div className="container-custom max-w-4xl">{errorNotice}</div></div>;
  }

  if (!isHydrated || !isAuthenticated || loading || loadedKey !== sessionKey) {
    return (
      <div className="py-8">
        <div className="container-custom">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-300 rounded-sm w-1/4"></div>
            <div className="card p-6">
              <div className="h-32 bg-gray-300 rounded-sm"></div>
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
        {errorNotice}
        {unresolved && <div className="card p-6 mb-6" role="alert">
          <p>{t(unresolved.checking ? '订单更新结果未知，正在核对实际状态...' : '订单更新结果尚未确认，请重新核对订单；确认前不会再次提交')}</p>
          <button className="btn btn-secondary mt-4" disabled={unresolved.checking || actionPending} onClick={() => { const record = recovery.current; if (record?.key === sessionKey) void checkOrder(record); }}>{t('重新核对订单')}</button>
        </div>}
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
                <div className="mt-2 flex items-center gap-1.5 text-sm text-orange-600">
                  <FiClock className="h-4 w-4" aria-hidden="true" />
                  {t('剩余支付时间: {minutes} 分钟', { minutes: remainingTime })}
                </div>
              )}
              {order.status === 0 && remainingTime === 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-sm text-red-600" role="alert">
                  <FiAlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {t("订单已超时，即将自动取消")}
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
                <ProductImage src={item.product_image} alt={localizedText(item.product_name, item.product_name_en, locale)} compact className="h-20 w-20 shrink-0 rounded-lg border border-gray-200" />
                <div className="flex-1">
                  <h3 className="font-medium">{localizedText(item.product_name, item.product_name_en, locale)}</h3>
                  {item.sku_specs && <p className="text-gray-600 text-sm mt-1">{specSummary(item.sku_specs, item.sku_specs_en, locale)}</p>}
                  {item.sku_code && <p className="text-gray-500 text-xs mt-1">{t("规格编号：")}{item.sku_code}</p>}
                  <p className="text-gray-600 text-sm mt-1">¥{item.price} × {item.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">¥{(Number(item.price) * item.quantity).toFixed(2)}</p>
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

        {order.status === 3 && <OrderReviews key={`${sessionKey}:reviews`} orderId={orderId} items={items} />}
        {[1, 2, 3].includes(order.status) && <OrderAfterSales key={`${sessionKey}:after-sales`} orderId={orderId} />}

        {/* 操作按钮 */}
        <div className="flex justify-end space-x-3">
          <button onClick={() => router.push('/orders')} className="btn btn-secondary">
            {t("返回订单列表")}
          </button>

          {order.status === 0 && (
            <>
              {payments.canPay && <button onClick={handlePay} disabled={actionsBlocked} className="btn btn-primary">
                {t("模拟支付")}
              </button>}
              <button onClick={handleCancel} disabled={actionsBlocked} className="btn btn-secondary">
                {t("取消订单")}
              </button>
            </>
          )}

          {order.status === 2 && (
            <button onClick={handleConfirm} disabled={actionsBlocked} className="btn btn-primary">
              {t("确认收货")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
