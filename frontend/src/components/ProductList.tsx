'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { productApi, type ProductList as ProductListResult } from '@/lib/api';
import ProductCard, { ProductCardSkeleton } from '@/components/ProductCard';
import { FiPackage } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

const LIMIT = 20;

export interface ProductListSeed {
  keyword: string;
  sort: string;
  list: ProductListResult;
}

/**
 * The product list. The server renders page one of the URL's search as `seed`, so the HTML carries
 * the products; the client refreshes it after hydration and loads later pages itself.
 */
export default function ProductListView({ seed = null }: { seed?: ProductListSeed | null }) {
  const { t } = useI18n();
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const keyword = searchParams.get('keyword') || '';
  const sort = searchParams.get('sort') || 'created_at DESC';
  // A page belongs to the keyword and sort it was chosen for; a new search, or a return to an earlier one, starts on page one.
  const [pageState, setPageState] = useState({ keyword, sort, page: 1 });
  if (pageState.keyword !== keyword || pageState.sort !== sort) setPageState({ keyword, sort, page: 1 });
  const page = pageState.keyword === keyword && pageState.sort === sort ? pageState.page : 1;
  const scope = JSON.stringify([keyword, sort, page]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const seeded = seed && seed.keyword === keyword && seed.sort === sort && page === 1 ? seed.list : undefined;
  const query = useQuery({
    queryKey: ['products', keyword, sort, page],
    queryFn: () => productApi.list({ keyword, sort, page, limit: LIMIT }),
    initialData: seeded,
  });
  const data = query.data;
  const products = data?.products || [];
  const totalPages = data?.totalPages || 0;
  // A failed refresh keeps the products already shown; only a search with nothing to show reports the error in place.
  // A retry of such a search is pending again, so it shows the skeleton rather than the old error.
  const loadError = !data && query.isError;
  const loading = !data && !loadError;
  const pagination = { page, totalPages };

  useEffect(() => {
    if (!query.error) return;
    logger.error('加载商品失败:', query.error);
    toast.error(t('加载商品失败'));
  }, [query.error]);

  const handlePageChange = (next: number) => {
    if (currentScope.current !== scope || next < 1 || next > totalPages || next === page) return;
    setPageState({ keyword, sort, page: next });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="py-10">
      <div className="container-custom">
        {/* 头部 */}
        <div className="mb-8 border-b border-gray-200 pb-6">
          <h1 className="mb-3 text-2xl font-semibold tracking-tight text-gray-900 md:text-3xl">
            {keyword ? t('搜索结果: {keyword}', { keyword }) : t("全部商品")}
          </h1>
          
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-500">
              {t('共找到 {count} 件商品', { count: data ? data.total : '—' })}</div>
            
            <div className="flex items-center gap-3">
              <label htmlFor="product-sort" className="text-sm text-gray-500">{t("排序:")}</label>
              <select
                id="product-sort"
                value={sort}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('sort', e.target.value);
                  params.delete('page');
                  router.push(`/products?${params.toString()}`);
                }}
                className="input h-10 w-auto py-0 text-sm"
              >
                <option value="created_at DESC">{t("最新")}</option>
                <option value="sales_count DESC">{t("最热")}</option>
                <option value="price ASC">{t("价格从低到高")}</option>
                <option value="price DESC">{t("价格从高到低")}</option>
              </select>
            </div>
          </div>
        </div>

        {/* 商品列表 */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {[...Array(12)].map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <div className="text-center py-20" role="alert">
            <p className="text-red-600">{t('加载商品失败')}</p>
            <button onClick={() => void query.refetch()} className="btn btn-secondary mt-4">{t('重新加载')}</button>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <FiPackage className="h-7 w-7" aria-hidden="true" />
            </span>
            <h2 className="mb-1 text-lg font-medium text-gray-900">{t("暂无商品")}</h2>
            <p className="text-sm text-gray-500">{t("换个关键词试试吧")}</p>
          </div>
        ) : (
          <>
            {/* Product cards use <h3>; this keeps the outline h1 > h2 > h3 for screen readers. */}
            <h2 className="sr-only">{t('商品列表')}</h2>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.product_id} product={product} />
              ))}
            </div>

            {/* 分页 */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center mt-12">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="btn btn-secondary disabled:opacity-50"
                  >
                    {t("上一页")}</button>
                  
                  {[...Array(pagination.totalPages)].map((_, i) => {
                    const page = i + 1;
                    if (
                      page === 1 ||
                      page === pagination.totalPages ||
                      (page >= pagination.page - 2 && page <= pagination.page + 2)
                    ) {
                      return (
                        <button
                          key={page}
                          onClick={() => handlePageChange(page)}
                          className={`btn ${
                            page === pagination.page ? 'btn-primary' : 'btn-secondary'
                          }`}
                        >
                          {page}
                        </button>
                      );
                    } else if (page === pagination.page - 3 || page === pagination.page + 3) {
                      return <span key={page} className="px-1 text-gray-500">...</span>;
                    }
                    return null;
                  })}
                  
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page === pagination.totalPages}
                    className="btn btn-secondary disabled:opacity-50"
                  >
                    {t("下一页")}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
