'use client';

import type { FormEvent } from 'react';
import { useI18n } from '@/lib/i18n';

export interface CouponFormValues {
  code: string;
  name: string;
  description: string;
  type: number;
  discount_value: number;
  min_amount: number;
  max_discount: number;
  total_quantity: number;
  per_user_limit: number;
  /** `datetime-local` values in the administrator's time zone. */
  start_time: string;
  end_time: string;
}

export const EMPTY_COUPON_FORM: CouponFormValues = {
  code: '', name: '', description: '', type: 1, discount_value: 0, min_amount: 0, max_discount: 0,
  total_quantity: 100, per_user_limit: 1, start_time: '', end_time: '',
};

interface Props {
  values: CouponFormValues;
  onChange: (values: CouponFormValues) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

/** The modal form that creates a coupon. */
export default function AdminCouponForm({ values, onChange, onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const set = <K extends keyof CouponFormValues>(field: K, value: CouponFormValues[K]) => onChange({ ...values, [field]: value });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">{t("创建优惠券")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="formData-code" className={labelClass}>{t("优惠券代码 *")}</label>
              <input id="formData-code" type="text" required value={values.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
                className={inputClass} placeholder={t("例如: SUMMER2024")} />
            </div>
            <div>
              <label htmlFor="formData-name" className={labelClass}>{t("优惠券名称 *")}</label>
              <input id="formData-name" type="text" required value={values.name}
                onChange={e => set('name', e.target.value)}
                className={inputClass} placeholder={t("例如: 夏季促销券")} />
            </div>
          </div>

          <div>
            <label htmlFor="formData-description" className={labelClass}>{t("描述")}</label>
            <textarea id="formData-description" value={values.description}
              onChange={e => set('description', e.target.value)}
              className={inputClass} rows={2} placeholder={t("优惠券说明")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="formData-type" className={labelClass}>{t("类型 *")}</label>
              <select id="formData-type" value={values.type} onChange={e => set('type', Number(e.target.value))} className={inputClass}>
                <option value={1}>{t("满减券")}</option>
                <option value={2}>{t("折扣券")}</option>
                <option value={3}>{t("无门槛券")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="formData-discount-value" className={labelClass}>
                {values.type === 2 ? t("减免比例 (%)，20表示8折 *") : t("优惠值 (元) *")}
              </label>
              <input id="formData-discount-value" type="number" required min="0" step="0.01" value={values.discount_value}
                onChange={e => set('discount_value', Number(e.target.value))} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="formData-min-amount" className={labelClass}>{t("最低消费金额 (元)")}</label>
              <input id="formData-min-amount" type="number" min="0" step="0.01" value={values.min_amount}
                onChange={e => set('min_amount', Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="formData-max-discount" className={labelClass}>{t("最大优惠金额 (元)")}</label>
              <input id="formData-max-discount" type="number" min="0" step="0.01" value={values.max_discount}
                onChange={e => set('max_discount', Number(e.target.value))} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="formData-total-quantity" className={labelClass}>{t("发行总量 *")}</label>
              <input id="formData-total-quantity" type="number" required min="1" value={values.total_quantity}
                onChange={e => set('total_quantity', Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="formData-per-user-limit" className={labelClass}>{t("每人限领 *")}</label>
              <input id="formData-per-user-limit" type="number" required min="1" value={values.per_user_limit}
                onChange={e => set('per_user_limit', Number(e.target.value))} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="formData-start-time" className={labelClass}>{t("生效时间 *")}</label>
              <input id="formData-start-time" type="datetime-local" required value={values.start_time}
                onChange={e => set('start_time', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="formData-end-time" className={labelClass}>{t("失效时间 *")}</label>
              <input id="formData-end-time" type="datetime-local" required value={values.end_time}
                onChange={e => set('end_time', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              {t("取消")}
            </button>
            <button type="submit" className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
              {t("创建")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
