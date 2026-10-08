'use client';

import { useRouter } from 'next/navigation';
import { FiTrash2 } from 'react-icons/fi';
import ProductImage from '@/components/ProductImage';
import { useI18n } from '@/lib/i18n';
import { localizedText, specSummary } from '@/lib/product-content';
import type { CartItem } from '@/store/useCartStore';

export const isCartItemAvailable = (item: CartItem) => item.available !== false && item.available !== 0;
/** An unavailable line can still be reduced when only its quantity is too high for the remaining stock. */
export const canReduceCartItem = (item: CartItem) =>
  isCartItemAvailable(item) || (item.unavailable_reason === '库存不足' && item.stock > 0);

interface Props {
  item: CartItem;
  selected: boolean;
  submitting: boolean;
  onToggle: () => void;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}

/** One cart line: its selection, product details, quantity stepper, subtotal and remove button. */
export default function CartItemRow({ item, selected, submitting, onToggle, onQuantityChange, onRemove }: Props) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const title = localizedText(item.title, item.title_en, locale);
  const available = isCartItemAvailable(item);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="checkbox"
          aria-label={t("选择 {title}", { title })}
          checked={available && selected}
          disabled={submitting || !available}
          onChange={onToggle}
          className="h-5 w-5 rounded-sm accent-primary-600"
        />

        <ProductImage src={item.main_image} alt={title} compact className="h-24 w-24 shrink-0 rounded-lg border border-gray-200" />

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-gray-900">{title}</h3>
          {item.sku_specs && <p className="text-sm text-gray-600 mt-1">{specSummary(item.sku_specs, item.sku_specs_en, locale)}</p>}
          {item.sku_code && <p className="text-xs text-gray-500 mt-1">{t("规格编号：")}{item.sku_code}</p>}
          {!available && (
            <div className="text-sm text-red-600 mt-1">
              <p>{t(item.unavailable_reason || '商品当前不可用')}</p>
              <button onClick={() => router.push(`/products/${item.product_id}`)} className="underline">{t("重新选规格")}</button>
            </div>
          )}
          <p className="text-primary-600 font-medium mt-1">¥{item.price}</p>
          {item.stock < 10 && (
            <p className="text-orange-500 text-sm mt-1">{t('仅剩 {count} 件', { count: item.stock })}</p>
          )}
        </div>

        <div className="flex w-full items-center justify-end gap-4 sm:w-auto">
          <div className="flex items-center overflow-hidden rounded-lg border border-gray-300">
            <button
              onClick={() => onQuantityChange(Math.min(item.quantity - 1, item.stock))}
              disabled={submitting || !canReduceCartItem(item) || item.quantity <= 1}
              className="h-9 w-9 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              -
            </button>
            <span className="flex h-9 min-w-12 items-center justify-center border-x border-gray-300 px-3 text-sm">
              {item.quantity}
            </span>
            <button
              onClick={() => onQuantityChange(item.quantity + 1)}
              disabled={submitting || !available || item.quantity >= item.stock}
              className="h-9 w-9 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              +
            </button>
          </div>

          <div className="min-w-20 text-right">
            <p className="text-lg font-semibold text-gray-900">¥{(Number(item.price) * item.quantity).toFixed(2)}</p>
          </div>

          <button
            onClick={onRemove}
            disabled={submitting}
            aria-label={t('删除')}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-red-500"
          >
            <FiTrash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
