'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { couponApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';

interface UserCoupon {
  user_coupon_id: number;
  user_id: number;
  coupon_id: number;
  status: number;
  used_at?: string;
  order_id?: number;
  received_at: string;
  expired_at: string;
  code: string;
  name: string;
  description: string;
  type: number;
  discount_value: number;
  min_amount: number;
  max_discount?: number;
}

const STATUS_TABS = [
  { value: 1, label: '未使用', color: 'text-blue-600' },
  { value: 2, label: '已使用', color: 'text-gray-600' },
  { value: 3, label: '已过期', color: 'text-red-600' },
];

export default function MyCouponsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [coupons, setCoupons] = useState<UserCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState(1);

  useEffect(() => {
    if (!isAuthenticated) {
      toast.error('请先登录');
      router.push('/login');
      return;
    }
    loadCoupons();
  }, [isAuthenticated, activeStatus, router]);

  const loadCoupons = async () => {
    try {
      setLoading(true);
      const response = await couponApi.getMyCoupons(activeStatus);
      setCoupons(response.data || []);
    } catch (error: any) {
      console.error('加载优惠券失败:', error);
      toast.error(error.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const getCouponTypeText = (type: number) => {
    switch (type) {
      case 1:
        return '满减券';
      case 2:
        return '折扣券';
      case 3:
        return '无门槛券';
      default:
        return '优惠券';
    }
  };

  const getCouponDescription = (coupon: UserCoupon) => {
    switch (coupon.type) {
      case 1:
        return `满${coupon.min_amount}元减${coupon.discount_value}元`;
      case 2:
        const discount = 100 - coupon.discount_value;
        const maxText = coupon.max_discount
          ? `，最高优惠${coupon.max_discount}元`
          : '';
        return `${discount / 10}折优惠${maxText}`;
      case 3:
        return `直接抵扣${coupon.discount_value}元`;
      default:
        return coupon.description;
    }
  };

  const getCouponColor = (type: number, status: number) => {
    if (status !== 1) {
      return 'from-gray-400 to-gray-500';
    }
    switch (type) {
      case 1:
        return 'from-orange-500 to-red-500';
      case 2:
        return 'from-blue-500 to-indigo-500';
      case 3:
        return 'from-green-500 to-emerald-500';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const handleUse = (coupon: UserCoupon) => {
    // 跳转到商品列表或购物车
    router.push('/products');
    toast.success('快去选购商品吧！');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">我的优惠券</h1>
          <p className="mt-2 text-gray-600">查看和使用你的优惠券</p>

          <div className="mt-4 flex gap-4">
            <button
              onClick={() => router.push('/coupons')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              领取更多优惠券
            </button>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex border-b">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveStatus(tab.value)}
                className={`flex-1 px-6 py-4 text-center font-medium transition-colors ${
                  activeStatus === tab.value
                    ? `${tab.color} border-b-2 border-current`
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Coupons List */}
        {coupons.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="mt-4 text-gray-500">
              {activeStatus === 1 && '暂无未使用的优惠券'}
              {activeStatus === 2 && '暂无已使用的优惠券'}
              {activeStatus === 3 && '暂无已过期的优惠券'}
            </p>
            {activeStatus === 1 && (
              <button
                onClick={() => router.push('/coupons')}
                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                去领取优惠券
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coupons.map((coupon) => (
              <div
                key={coupon.user_coupon_id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow relative"
              >
                {/* Status Badge */}
                {coupon.status !== 1 && (
                  <div className="absolute top-4 right-4 z-10">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {coupon.status === 2 && '已使用'}
                      {coupon.status === 3 && '已过期'}
                    </span>
                  </div>
                )}

                {/* Coupon Header */}
                <div className={`bg-gradient-to-r ${getCouponColor(coupon.type, coupon.status)} p-6 text-white ${coupon.status !== 1 ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm opacity-90">{getCouponTypeText(coupon.type)}</div>
                      <div className="text-3xl font-bold mt-1">
                        {coupon.type === 2 ? `${100 - coupon.discount_value}折` : `¥${coupon.discount_value}`}
                      </div>
                      <div className="text-sm opacity-90 mt-1">
                        {coupon.type === 1 && `满${coupon.min_amount}元可用`}
                        {coupon.type === 2 && coupon.min_amount > 0 && `满${coupon.min_amount}元可用`}
                        {coupon.type === 3 && '无门槛'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Coupon Body */}
                <div className="p-6">
                  <h3 className="font-semibold text-gray-900 mb-2">{coupon.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{getCouponDescription(coupon)}</p>

                  <div className="space-y-2 text-xs text-gray-500 mb-4">
                    <div className="flex justify-between">
                      <span>领取时间</span>
                      <span>{new Date(coupon.received_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>有效期至</span>
                      <span>{new Date(coupon.expired_at).toLocaleDateString()}</span>
                    </div>
                    {coupon.status === 2 && coupon.used_at && (
                      <div className="flex justify-between">
                        <span>使用时间</span>
                        <span>{new Date(coupon.used_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  {coupon.status === 1 && (
                    <button
                      onClick={() => handleUse(coupon)}
                      className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      立即使用
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

