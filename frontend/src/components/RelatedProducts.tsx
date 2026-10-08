'use client';

import ProductCard from '@/components/ProductCard';
import type { Product } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Hide only a successful empty response; pending and failed requests remain visible. */
export default function RelatedProducts({ products, loading, error = false, onRetry }: {
  products: Product[]; loading: boolean; error?: boolean; onRetry?: () => void;
}) {
  const { t } = useI18n();
  if (products.length === 0 && !loading && !error) return null;

  return (
    <section aria-busy={loading}>
      <h2 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">{t("相关推荐")}</h2>

      {loading ? (
        <p role="status" className="py-12 text-center text-sm text-gray-500">{t("加载中...")}</p>
      ) : error ? (
        <div role="alert" className="py-8 text-center">
          <p className="text-red-600">{t('加载推荐失败，请重试')}</p>
          <button className="btn btn-secondary mt-4" onClick={onRetry}>{t('重新加载')}</button>
        </div>
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
