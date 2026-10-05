'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { couponApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

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
  discount_value: number | string;
  min_amount: number | string;
  max_discount?: number | string | null;
  coupon_status?: number;
  start_time?: string;
  end_time?: string;
}

const STATUS_TABS = [
  { value: 1, label: '未使用' },
  { value: 2, label: '已使用' },
  { value: 3, label: '已过期' },
];

export default function MyCouponsPage() {
  const router = useRouter();
  const { t, locale, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const [coupons, setCoupons] = useState<UserCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState(1);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = JSON.stringify([token, user?.user_id, activeStatus]);
  const isCurrentSession = () => {
    const current = useAuthStore.getState();
    return current.isAuthenticated && current.token === token && current.user?.user_id === user?.user_id &&
      localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    setCoupons([]);
    if (!isHydrated) return;
    if (!isAuthenticated) {
      toast.error(t('请先登录'));
      router.push('/login');
      return;
    }
    let active = true;
    setLoading(true);
    couponApi.getMyCoupons(activeStatus).then(response => {
      if (active && isCurrentSession()) setCoupons(response.data || []);
    }).catch(error => {
      if (!active || !isCurrentSession()) return;
      logger.error('加载优惠券失败:', error);
      toast.error(t(error.response?.data?.message || '加载失败'));
    }).finally(() => {
      if (active && isCurrentSession()) {
        setLoadedKey(requestKey);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [isHydrated, isAuthenticated, token, user?.user_id, activeStatus, router]);

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
        return t('满{minimum}元减{discount}元', { minimum: coupon.min_amount, discount: coupon.discount_value });
      case 2:
        const discount = 100 - Number(coupon.discount_value);
        const maxText = Number(coupon.max_discount) > 0
          ? t('，最高优惠{maximum}元', { maximum: coupon.max_discount ?? 0 })
          : '';
        return (locale === 'en' ? t('{percentage}%优惠', { percentage: Number(coupon.discount_value) }) : t('{discount}折优惠', { discount: discount / 10 })) + maxText;
      case 3:
        return t('直接抵扣{discount}元', { discount: coupon.discount_value });
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
      case 2:
      case 3:
        return 'from-primary-500 to-primary-700';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const handleUse = (coupon: UserCoupon) => {
    if (!isCurrentSession()) return;
    if (!canUseCoupon(coupon)) {
      toast.error(t('优惠券当前不可用'));
      return;
    }
    router.push(`/cart?user_coupon_id=${coupon.user_coupon_id}`);
  };

  const canUseCoupon = (coupon: UserCoupon) => {
    const now = Date.now();
    return coupon.status === 1 && coupon.coupon_status !== 0 &&
      new Date(coupon.expired_at).getTime() > now &&
      (!coupon.start_time || new Date(coupon.start_time).getTime() <= now) &&
      (!coupon.end_time || new Date(coupon.end_time).getTime() > now);
  };

  if (!isHydrated || !isAuthenticated || loading || loadedKey !== requestKey) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">{t("加载中...")}</p>
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
          <h1 className="text-3xl font-bold text-gray-900">{t("我的优惠券")}</h1>
          <p className="mt-2 text-gray-600">{t("查看和使用你的优惠券")}</p>

          <div className="mt-4 flex gap-4">
            <button
              onClick={() => router.push('/coupons')}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              {t("领取更多优惠券")}
            </button>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="flex border-b">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveStatus(tab.value)}
                aria-pressed={activeStatus === tab.value}
                className={`flex-1 px-6 py-4 text-center font-medium transition-colors ${
                  activeStatus === tab.value
                    ? 'text-primary-600 border-b-2 border-current'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Coupons List */}
        {coupons.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="mt-4 text-gray-500">
              {activeStatus === 1 && t('暂无未使用的优惠券')}
              {activeStatus === 2 && t('暂无已使用的优惠券')}
              {activeStatus === 3 && t('暂无已过期的优惠券')}
            </p>
            {activeStatus === 1 && (
              <button
                onClick={() => router.push('/coupons')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                {t("去领取优惠券")}
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
                      {coupon.status === 2 && t('已使用')}
                      {coupon.status === 3 && t('已过期')}
                    </span>
                  </div>
                )}

                {/* Coupon Header */}
                <div className={`bg-linear-to-r/srgb ${getCouponColor(coupon.type, coupon.status)} p-6 text-white ${coupon.status !== 1 ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm opacity-90">{t(getCouponTypeText(coupon.type))}</div>
                      <div className="text-3xl font-bold mt-1">
                        {coupon.type === 2 ? (locale === 'en' ? t('{percentage}%优惠', { percentage: Number(coupon.discount_value) }) : t('{discount}折', { discount: (100 - Number(coupon.discount_value)) / 10 })) : `¥${coupon.discount_value}`}
                      </div>
                      <div className="text-sm opacity-90 mt-1">
                        {coupon.type === 1 && t('满{minimum}元可用', { minimum: coupon.min_amount })}
                        {coupon.type === 2 && Number(coupon.min_amount) > 0 && t('满{minimum}元可用', { minimum: coupon.min_amount })}
                        {coupon.type === 3 && t('无门槛')}
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
                      <span>{t("领取时间")}</span>
                      <span>{formatDate(coupon.received_at, true)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t("有效期至")}</span>
                      <span>{formatDate(coupon.expired_at, true)}</span>
                    </div>
                    {coupon.status === 2 && coupon.used_at && (
                      <div className="flex justify-between">
                        <span>{t("使用时间")}</span>
                        <span>{formatDate(coupon.used_at, true)}</span>
                      </div>
                    )}
                  </div>

                  {coupon.status === 1 && (
                    <button
                      onClick={() => handleUse(coupon)}
                      disabled={!canUseCoupon(coupon)}
                      className="w-full py-2 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                    >
                      {canUseCoupon(coupon) ? t('立即使用') : t('暂不可用')}
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
