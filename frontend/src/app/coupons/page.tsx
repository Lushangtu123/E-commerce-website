'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { couponApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';

interface Coupon {
  coupon_id: number;
  code: string;
  name: string;
  description: string;
  type: number;
  discount_value: number;
  min_amount: number;
  max_discount?: number;
  total_quantity: number;
  remain_quantity: number;
  per_user_limit: number;
  start_time: string;
  end_time: string;
  status: number;
}

export default function CouponsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [receivingIds, setReceivingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isAuthenticated) {
      toast.error('请先登录');
      router.push('/login');
      return;
    }
    loadCoupons();
  }, [isAuthenticated, router]);

  const loadCoupons = async () => {
    try {
      setLoading(true);
      const response = await couponApi.getAvailable(1, 50);
      setCoupons(response.data || []);
    } catch (error: any) {
      console.error('加载优惠券失败:', error);
      toast.error(error.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReceive = async (coupon: Coupon) => {
    if (!isAuthenticated) {
      toast.error('请先登录');
      router.push('/login');
      return;
    }

    setReceivingIds(prev => new Set(prev).add(coupon.coupon_id));

    try {
      await couponApi.receive(coupon.code);
      toast.success('领取成功！');
      
      // 更新剩余数量
      setCoupons(prevCoupons =>
        prevCoupons.map(c =>
          c.coupon_id === coupon.coupon_id
            ? { ...c, remain_quantity: c.remain_quantity - 1 }
            : c
        )
      );
    } catch (error: any) {
      console.error('领取失败:', error);
      const message = error.response?.data?.message || '领取失败';
      toast.error(message);
    } finally {
      setReceivingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(coupon.coupon_id);
        return newSet;
      });
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

  const getCouponDescription = (coupon: Coupon) => {
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

  const getCouponColor = (type: number) => {
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
          <h1 className="text-3xl font-bold text-gray-900">优惠券中心</h1>
          <p className="mt-2 text-gray-600">领取优惠券，享受更多优惠</p>
          
          <div className="mt-4 flex gap-4">
            <button
              onClick={() => router.push('/my/coupons')}
              className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
            >
              我的优惠券
            </button>
          </div>
        </div>

        {/* Coupons Grid */}
        {coupons.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="mt-4 text-gray-500">暂无可领取的优惠券</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coupons.map((coupon) => (
              <div
                key={coupon.coupon_id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Coupon Header */}
                <div className={`bg-gradient-to-r ${getCouponColor(coupon.type)} p-6 text-white`}>
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
                    <div className="text-right text-sm opacity-90">
                      <div>剩余</div>
                      <div className="text-xl font-semibold">{coupon.remain_quantity}</div>
                    </div>
                  </div>
                </div>

                {/* Coupon Body */}
                <div className="p-6">
                  <h3 className="font-semibold text-gray-900 mb-2">{coupon.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{getCouponDescription(coupon)}</p>
                  
                  {coupon.description && (
                    <p className="text-xs text-gray-500 mb-4">{coupon.description}</p>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>有效期至 {new Date(coupon.end_time).toLocaleDateString()}</span>
                    <span>限领 {coupon.per_user_limit} 张</span>
                  </div>

                  <button
                    onClick={() => handleReceive(coupon)}
                    disabled={receivingIds.has(coupon.coupon_id) || coupon.remain_quantity === 0}
                    className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                      coupon.remain_quantity === 0
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : receivingIds.has(coupon.coupon_id)
                        ? 'bg-gray-400 text-white cursor-wait'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {receivingIds.has(coupon.coupon_id)
                      ? '领取中...'
                      : coupon.remain_quantity === 0
                      ? '已领完'
                      : '立即领取'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

