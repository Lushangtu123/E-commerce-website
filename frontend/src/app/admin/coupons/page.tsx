'use client';

import { useI18n } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { adminCouponApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import AdminCouponForm, { EMPTY_COUPON_FORM } from '@/components/AdminCouponForm';
import AdminCouponTable, { type AdminCoupon } from '@/components/AdminCouponTable';

export default function AdminCouponsPage() {
  const { t } = useI18n();
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState(EMPTY_COUPON_FORM);

  useEffect(() => {
    loadCoupons();
  }, []);

  const loadCoupons = async () => {
    try {
      setLoading(true);
      const response = await adminCouponApi.getList(1, 50);
      setCoupons(response.data || []);
    } catch (error) {
      logger.error('加载优惠券失败:', error);
      toast.error(t(requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await adminCouponApi.create({
        ...formData,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
      });
      
      toast.success(t('创建成功！'));
      setShowCreateForm(false);
      loadCoupons();
      
      // 重置表单
      setFormData(EMPTY_COUPON_FORM);
    } catch (error) {
      logger.error('创建失败:', error);
      toast.error(t(requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || '创建失败'));
    }
  };

  const handleUpdateStatus = async (id: number, status: number) => {
    try {
      await adminCouponApi.updateStatus(id, status);
      toast.success(t('状态更新成功！'));
      loadCoupons();
    } catch (error) {
      logger.error('更新失败:', error);
      toast.error(t(requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || '更新失败'));
    }
  };

  if (loading) {
    return (
      <AdminLayout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">{t("加载中...")}</p>
          </div>
        </div>
      </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t("优惠券管理")}</h1>
            <p className="mt-2 text-gray-600">{t("创建和管理优惠券")}</p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            {t("+ 创建优惠券")}
          </button>
        </div>

        {showCreateForm && (
          <AdminCouponForm values={formData} onChange={setFormData} onSubmit={handleCreate} onClose={() => setShowCreateForm(false)} />
        )}

        <AdminCouponTable coupons={coupons} onCreate={() => setShowCreateForm(true)}
          onToggleStatus={coupon => handleUpdateStatus(coupon.coupon_id, coupon.status === 1 ? 0 : 1)} />
      </div>
    </div>
    </AdminLayout>
  );
}
