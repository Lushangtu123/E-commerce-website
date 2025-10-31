'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { orderApi, orderTimeoutApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';

const ORDER_STATUS = {
  0: { text: '待支付', color: 'text-orange-600' },
  1: { text: '已支付', color: 'text-blue-600' },
  2: { text: '已发货', color: 'text-green-600' },
  3: { text: '已完成', color: 'text-gray-600' },
  4: { text: '已取消', color: 'text-red-600' },
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);

  const orderId = parseInt(params.id as string);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadOrder();
  }, [isAuthenticated, orderId]);

  useEffect(() => {
    if (order && order.status === 0) {
      loadRemainingTime();
      const interval = setInterval(loadRemainingTime, 60000); // 每分钟更新一次
      return () => clearInterval(interval);
    }
  }, [order]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      const data: any = await orderApi.getDetail(orderId);
      setOrder(data.order);
      setItems(data.items || []);
    } catch (error: any) {
      console.error('加载订单失败:', error);
      toast.error('订单不存在');
      router.push('/orders');
    } finally {
      setLoading(false);
    }
  };

  const loadRemainingTime = async () => {
    try {
      const data: any = await orderTimeoutApi.getRemainingTime(orderId);
      setRemainingTime(data.remaining_minutes);
      
      // 如果剩余时间为0，刷新订单状态
      if (data.remaining_minutes === 0) {
        loadOrder();
      }
    } catch (error: any) {
      console.error('加载剩余时间失败:', error);
    }
  };

  const handlePay = async () => {
    try {
      await orderApi.pay(orderId);
      toast.success('支付成功');
      loadOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '支付失败');
    }
  };

  const handleCancel = async () => {
    if (!confirm('确定要取消订单吗？')) return;

    try {
      await orderApi.cancel(orderId);
      toast.success('订单已取消');
      loadOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '取消失败');
    }
  };

  const handleConfirm = async () => {
    try {
      await orderApi.confirm(orderId);
      toast.success('确认收货成功');
      loadOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '确认收货失败');
    }
  };

  if (loading) {
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
        <h1 className="text-3xl font-bold mb-8">订单详情</h1>

        {/* 订单状态 */}
        <div className="card p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-gray-600 mb-2">订单状态</div>
              <div className={`text-2xl font-bold ${ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].color}`}>
                {ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].text}
              </div>
              {order.status === 0 && remainingTime !== null && remainingTime > 0 && (
                <div className="mt-2 text-orange-600 text-sm">
                  ⏰ 剩余支付时间: {remainingTime} 分钟
                </div>
              )}
              {order.status === 0 && remainingTime === 0 && (
                <div className="mt-2 text-red-600 text-sm">
                  ⚠️ 订单已超时，即将自动取消
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-gray-600 mb-2">订单号</div>
              <div className="font-mono">{order.order_no}</div>
            </div>
          </div>
        </div>

        {/* 商品列表 */}
        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">商品信息</h2>
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
                      无图
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">{item.product_name}</h3>
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
          <h2 className="font-bold text-lg mb-4">订单金额</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-gray-600">
              <span>商品总价</span>
              <span>¥{order.total_amount}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>运费</span>
              <span className="text-green-600">免运费</span>
            </div>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="font-medium">实付款</span>
              <span className="text-2xl font-bold text-primary-600">
                ¥{order.total_amount}
              </span>
            </div>
          </div>
        </div>

        {/* 时间信息 */}
        <div className="card p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">订单时间</h2>
          <div className="space-y-2 text-gray-600">
            <div className="flex justify-between">
              <span>下单时间</span>
              <span>{new Date(order.created_at).toLocaleString()}</span>
            </div>
            {order.paid_at && (
              <div className="flex justify-between">
                <span>支付时间</span>
                <span>{new Date(order.paid_at).toLocaleString()}</span>
              </div>
            )}
            {order.shipped_at && (
              <div className="flex justify-between">
                <span>发货时间</span>
                <span>{new Date(order.shipped_at).toLocaleString()}</span>
              </div>
            )}
            {order.completed_at && (
              <div className="flex justify-between">
                <span>完成时间</span>
                <span>{new Date(order.completed_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end space-x-3">
          <button onClick={() => router.push('/orders')} className="btn btn-secondary">
            返回订单列表
          </button>

          {order.status === 0 && (
            <>
              <button onClick={handlePay} className="btn btn-primary">
                立即支付
              </button>
              <button onClick={handleCancel} className="btn btn-secondary">
                取消订单
              </button>
            </>
          )}

          {order.status === 2 && (
            <button onClick={handleConfirm} className="btn btn-primary">
              确认收货
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

