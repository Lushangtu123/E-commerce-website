'use client';

import '@/lib/admin-i18n';
import { useI18n } from '@/lib/i18n';

export interface AdminCoupon {
  coupon_id: number;
  code: string;
  name: string;
  description?: string;
  type: number;
  discount_value: number;
  min_amount?: number;
  max_discount?: number;
  total_quantity: number;
  remain_quantity: number;
  received_count: number;
  used_count: number;
  per_user_limit: number;
  start_time: string;
  end_time: string;
  status: number;
  created_at: string;
}

interface Props {
  coupons: AdminCoupon[];
  onCreate: () => void;
  onToggleStatus: (coupon: AdminCoupon) => void;
}

/** The administrator's coupon list, or an invitation to create the first coupon. */
export default function AdminCouponTable({ coupons, onCreate, onToggleStatus }: Props) {
  const { t, locale, formatDate } = useI18n();

  const typeText = (type: number) => {
    switch (type) {
      case 1: return t("满减券");
      case 2: return t("折扣券");
      case 3: return t("无门槛券");
      default: return t("未知");
    }
  };

  if (coupons.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="mt-4 text-gray-500">{t("暂无优惠券")}</p>
          <button onClick={onCreate} className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
            {t("创建第一个优惠券")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("优惠券信息")}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("类型")}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("数量")}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("使用情况")}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("状态")}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {coupons.map((coupon) => (
              <tr key={coupon.coupon_id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">{coupon.name}</div>
                  <div className="text-sm text-gray-500">{t("代码: {code}", { code: coupon.code })}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {formatDate(coupon.start_time, true)} - {formatDate(coupon.end_time, true)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900">{typeText(coupon.type)}</span>
                  <div className="text-xs text-gray-500">
                    {coupon.type === 2 ? (locale === 'en' ? t('减免 {percent}%', { percent: Number(coupon.discount_value) }) : t('{discount}折', { discount: (100 - coupon.discount_value) / 10 })) : `¥${coupon.discount_value}`}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{t("剩余: {count}", { count: coupon.remain_quantity })}</div>
                  <div className="text-xs text-gray-500">{t("总量: {count}", { count: coupon.total_quantity })}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{t("已领: {count}", { count: coupon.received_count })}</div>
                  <div className="text-xs text-gray-500">{t("已用: {count}", { count: coupon.used_count })}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${coupon.status === 1 ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                    {coupon.status === 1 ? t("启用") : t("禁用")}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => onToggleStatus(coupon)}
                    className={`px-3 py-1 rounded ${coupon.status === 1 ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'} transition-colors`}
                  >
                    {coupon.status === 1 ? t("禁用") : t("启用")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
