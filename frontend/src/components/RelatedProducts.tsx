'use client';

import ProductCard from '@/components/ProductCard';
import type { Product } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Products recommended alongside the one on display; renders nothing until there are some. */
export default function RelatedProducts({ products, loading }: { products: Product[]; loading: boolean }) {
  const { t } = useI18n();
  if (products.length === 0) return null;

  return (
    <section>
      <h2 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">{t("相关推荐")}</h2>

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {t("加载中...")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {products.map((relatedProduct) => (
            <ProductCard key={relatedProduct.product_id} product={relatedProduct} />
          ))}
        </div>
      )}
    </section>
  );
}
