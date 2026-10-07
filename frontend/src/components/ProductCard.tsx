'use client';

import { useI18n } from '@/lib/i18n';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { quickAddToCart } from '@/lib/quick-cart';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { FiShoppingCart } from 'react-icons/fi';
import { FaStar } from 'react-icons/fa';
import ProductImage from '@/components/ProductImage';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import type { Product } from '@/lib/api';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { t } = useI18n();
  const active = useRef(true);
  const productContext = useRef(product.product_id);
  productContext.current = product.product_id;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [isAdding, setIsAdding] = useState(false);
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      toast.error(t("请先登录"));
      return;
    }

    setIsAdding(true);
    try {
      const result = await quickAddToCart(product.product_id, () => active.current && productContext.current === product.product_id);
      if (result === 'select') router.push(`/products/${product.product_id}`);
      if (result === 'added') toast.success(t("已加入购物车"));
    } catch (error) {
      logger.error('加入购物车失败:', error);
      toast.error(t(requestFailure(error).response?.data?.error || requestFailure(error).message || "加入购物车失败"));
    } finally {
      if (active.current) setIsAdding(false);
    }
  };

  const soldOut = Number(product.stock) <= 0;
  const onSale = Number(product.original_price) > Number(product.price);

  return (
    <Link
      href={`/products/${product.product_id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <div className="relative">
        <ProductImage
          src={product.main_image}
          alt={product.title}
          className="aspect-square"
          imageClassName="transition-transform duration-300 group-hover:scale-105"
        />
        {onSale && (
          <span className="absolute left-3 top-3 rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-medium text-white">
            {t("促销")}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-gray-900">
          {product.title}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-primary-600">¥{product.price}</span>
          {onSale && (
            <span className="text-xs text-gray-500 line-through">
              ¥{product.original_price}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <FaStar className="h-3 w-3 text-amber-400" aria-hidden="true" />
              {product.rating}
            </span>
            <span className="hidden truncate sm:inline">{t('已售 {count}', { count: product.sales_count })}</span>
          </div>

          <button
            onClick={handleAddToCart}
            disabled={isAdding || soldOut}
            className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${
              soldOut
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            <FiShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {soldOut ? t("已售罄") : isAdding ? t("处理中...") : product.has_sku ? t("选规格") : t("加入")}
            </span>
          </button>
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-gray-200 bg-white" aria-hidden="true">
      <div className="aspect-square bg-gray-100" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 rounded bg-gray-100" />
        <div className="h-4 w-1/3 rounded bg-gray-100" />
      </div>
    </div>
  );
}
