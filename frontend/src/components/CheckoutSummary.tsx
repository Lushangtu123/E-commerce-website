'use client';

import Link from 'next/link';
import { FiShoppingBag } from 'react-icons/fi';
import type { OrderPreview, ShippingAddress } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Props {
  itemCount: number;
  submitting: boolean;
  addresses: ShippingAddress[];
  addressLoading: boolean;
  addressError?: string | null;
  selectedAddressId: number | undefined;
  onSelectAddress: (addressId: number) => void;
  onReloadAddresses: () => void;
  /** The server's price for the selected items and coupon; null until it arrives. */
  quote: OrderPreview | null;
  quoteLoading: boolean;
  quoteError: string | null;
  onRetryQuote: () => void;
  selectedCouponId: number | undefined;
  onSelectCoupon: (userCouponId: number | undefined) => void;
  onCheckout: () => void;
}

/** The cart's order summary: shipping address, server-priced totals, coupon and the checkout button. */
export default function CheckoutSummary({
  itemCount, submitting, addresses, addressLoading, addressError, selectedAddressId, onSelectAddress, onReloadAddresses,
  quote, quoteLoading, quoteError, onRetryQuote, selectedCouponId, onSelectCoupon, onCheckout,
}: Props) {
  const { t } = useI18n();
  const canCheckout = itemCount > 0 && !submitting && !!quote && !quoteLoading && !quoteError &&
    !addressLoading && !addressError && selectedAddressId !== undefined;

  return (
    <div className="card p-6 sticky top-24">
      <h3 className="font-bold text-lg mb-4">{t("订单摘要")}</h3>
      <div className="mb-6">
        <label htmlFor="shipping-address" className="block font-medium mb-2">{t("收货地址")}</label>
        {addressLoading ? <p className="text-sm text-gray-500">{t("收货地址加载中...")}</p> : addressError ? (
          <div className="text-sm text-red-600" role="alert">
            <p>{t(addressError)}</p>
            <button onClick={onReloadAddresses} className="underline mt-1">{t("重新加载地址")}</button>
          </div>
        ) : addresses.length === 0 ? <p className="text-sm text-gray-600">{t("请先添加收货地址")}</p> : (
          <select id="shipping-address" value={selectedAddressId ?? ''} disabled={submitting}
            onChange={event => onSelectAddress(Number(event.target.value))}
            className="w-full border border-gray-300 rounded-sm px-3 py-2">
            <option value="" disabled>{t("请选择收货地址")}</option>
            {addresses.map(address => <option key={address.address_id} value={address.address_id}>
              {address.receiver_name} {address.phone} · {address.province}{address.city}{address.district}{address.detail_address}
            </option>)}
          </select>
        )}
        <Link href="/profile/address" className="inline-block text-primary-600 text-sm underline mt-2">{t("管理收货地址")}</Link>
      </div>

      <div className="space-y-3 mb-6">
        <div className="flex justify-between text-gray-600">
          <span>{t("商品数量")}</span>
          <span>{t('{count} 件', { count: itemCount })}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>{t("商品总价")}</span>
          <span>{quote ? `¥${quote.original_amount.toFixed(2)}` : t('计算中...')}</span>
        </div>
        <div>
          <label htmlFor="checkout-coupon" className="block text-sm text-gray-600 mb-2">{t("优惠券")}</label>
          <select
            id="checkout-coupon"
            value={selectedCouponId ?? ''}
            disabled={submitting || quoteLoading || !quote}
            onChange={(event) => onSelectCoupon(event.target.value ? Number(event.target.value) : undefined)}
            className="w-full border border-gray-300 rounded-sm px-3 py-2"
          >
            <option value="">{t("不使用优惠券")}</option>
            {quote?.available_coupons.map(coupon => (
              <option key={coupon.user_coupon_id} value={coupon.user_coupon_id}>
                {t('{name}（优惠¥{amount}）', { name: coupon.name, amount: coupon.discount_amount.toFixed(2) })}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>{t("优惠券优惠")}</span>
          <span>{quote ? `-¥${quote.discount_amount.toFixed(2)}` : t('计算中...')}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>{t("运费")}</span>
          <span className="text-green-600">{t("免运费")}</span>
        </div>
        <div className="border-t pt-3 flex justify-between items-center">
          <span className="font-medium">{t("应付金额")}</span>
          <span className="text-2xl font-bold text-primary-600">
            {quote ? `¥${quote.total_amount.toFixed(2)}` : t('计算中...')}
          </span>
        </div>
        {quoteError && (
          <div className="text-sm text-red-600" role="alert">
            <p>{t(quoteError)}</p>
            <button onClick={onRetryQuote} className="mt-2 underline">{t("重新计算")}</button>
          </div>
        )}
      </div>

      <button onClick={onCheckout} disabled={!canCheckout} className="w-full btn btn-primary disabled:opacity-50">
        <FiShoppingBag className="inline mr-2" />
        {submitting ? t('提交中...') : t('结算 ({count})', { count: itemCount })}
      </button>
    </div>
  );
}
