'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import Link from 'next/link';

const ORDER_STATUS = {
  0: { text: '待支付', color: 'text-orange-600' },
  1: { text: '已支付', color: 'text-blue-600' },
  2: { text: '已发货', color: 'text-green-600' },
  3: { text: '已完成', color: 'text-gray-600' },
  4: { text: '已取消', color: 'text-red-600' },
};

export default function OrdersPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadOrders();
  }, [isAuthenticated, activeTab]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data: any = await orderApi.list({ status: activeTab });
      setOrders(data.orders || []);
    } catch (error: any) {
      console.error('加载订单失败:', error);
      toast.error('加载订单失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async (orderId: number) => {
    try {
      await orderApi.pay(orderId);
      toast.success('支付成功');
      loadOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '支付失败');
    }
  };

  const handleCancel = async (orderId: number) => {
    if (!confirm('确定要取消订单吗？')) return;

    try {
      await orderApi.cancel(orderId);
      toast.success('订单已取消');
      loadOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '取消失败');
    }
  };

  const handleConfirm = async (orderId: number) => {
    try {
      await orderApi.confirm(orderId);
      toast.success('确认收货成功');
      loadOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '确认收货失败');
    }
  };

  return (
    <div className="py-8">
      <div className="container-custom">
        <h1 className="text-3xl font-bold mb-8">我的订单</h1>

        {/* 状态筛选 */}
        <div className="card p-4 mb-6">
          <div className="flex space-x-4">
            <button
              onClick={() => setActiveTab(undefined)}
              className={`px-4 py-2 rounded ${
                activeTab === undefined ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setActiveTab(0)}
              className={`px-4 py-2 rounded ${
                activeTab === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              待支付
            </button>
            <button
              onClick={() => setActiveTab(1)}
              className={`px-4 py-2 rounded ${
                activeTab === 1 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              已支付
            </button>
            <button
              onClick={() => setActiveTab(2)}
              className={`px-4 py-2 rounded ${
                activeTab === 2 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              已发货
            </button>
            <button
              onClick={() => setActiveTab(3)}
              className={`px-4 py-2 rounded ${
                activeTab === 3 ? 'bg-primary-600 text-white' : 'bg-gray-100'
              }`}
            >
              已完成
            </button>
          </div>
        </div>

        {/* 订单列表 */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-6 animate-pulse">
                <div className="h-6 bg-gray-300 rounded w-1/4 mb-4"></div>
                <div className="h-24 bg-gray-300 rounded"></div>
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-2xl font-medium text-gray-900 mb-2">暂无订单</h3>
            <p className="text-gray-600 mb-6">快去购物吧</p>
            <Link href="/products" className="btn btn-primary">
              去购物
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.order_id} className="card p-6">
                <div className="flex justify-between items-center mb-4 pb-4 border-b">
                  <div className="flex items-center space-x-4">
                    <span className="text-gray-600">订单号: {order.order_no}</span>
                    <span className="text-gray-400">
                      {new Date(order.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span className={`font-medium ${ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].color}`}>
                    {ORDER_STATUS[order.status as keyof typeof ORDER_STATUS].text}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">订单金额</span>
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
                    查看详情
                  </Link>
                  
                  {order.status === 0 && (
                    <>
                      <button
                        onClick={() => handlePay(order.order_id)}
                        className="btn btn-primary"
                      >
                        立即支付
                      </button>
                      <button
                        onClick={() => handleCancel(order.order_id)}
                        className="btn btn-secondary"
                      >
                        取消订单
                      </button>
                    </>
                  )}

                  {order.status === 2 && (
                    <button
                      onClick={() => handleConfirm(order.order_id)}
                      className="btn btn-primary"
                    >
                      确认收货
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

