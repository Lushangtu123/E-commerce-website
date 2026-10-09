'use client';

import { useEffect, useRef } from 'react';
import { useCartAddRecovery } from '@/hooks/use-cart-add-recovery';
import { retryCartAdd } from '@/lib/cart-add';
import { translate, useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import toast from 'react-hot-toast';

/** Storefront-wide recovery follows the customer through navigation, without automatically resending POST. */
export default function CartAddRecovery() {
  const { t } = useI18n();
  const { pending, busy, blocked } = useCartAddRecovery();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!pending && !blocked) return null;
  return <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
    <div className="container mx-auto flex flex-wrap items-center gap-3">
      <p>{t(blocked ? '无法保存购物车添加请求，请恢复浏览器存储后重试' : busy ? '购物车添加正在处理中，请稍候' : '购物车添加结果尚未确认，请重试原请求')}</p>
      {pending && <>
        <span>{t('商品 #{id}', { id: pending.input.product_id })}{pending.input.sku_id != null && ` · ${t('规格 #{id}', { id: pending.input.sku_id })}`} · {t('数量：{count}', { count: pending.input.quantity })}</span>
        <button className="btn btn-secondary" disabled={busy} onClick={async () => {
          try {
            if (await retryCartAdd(() => mounted.current)) toast.success(translate('购物车已重新同步，请核对商品和数量'));
          } catch (error) {
            if (mounted.current) toast.error(translate(requestFailure(error).message || '购物车添加结果尚未确认，请重试原请求'));
          }
        }}>{t(busy ? '处理中...' : '重试原添加')}</button>
      </>}
    </div>
  </div>;
}
