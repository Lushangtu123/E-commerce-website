'use client';

import { translate, useI18n } from '@/lib/i18n';

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { productApi, type ProductList as ProductListResult } from '@/lib/api';
import ProductCard, { ProductCardSkeleton } from '@/components/ProductCard';
import { FiPackage } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import CatalogFilters from '@/components/CatalogFilters';
import { CATALOG_FILTER_KEYS, CATALOG_SORTS, catalogFilterParams, parseCatalogFilters, parseCatalogPage, readCatalogDraft, type CatalogFilters as Filters } from '@/lib/catalog-filters';

const LIMIT = 20;
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export interface ProductListSeed {
  keyword: string;
  sort: string;
  filters?: Filters;
  list: ProductListResult;
}

/**
 * The URL supplies the applied search and page. A matching server seed carries the products
 * in the HTML; the client refreshes that same page after hydration.
 */
export default function ProductListView({ seed = null }: { seed?: ProductListSeed | null }) {
  const { t } = useI18n();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const keyword = searchParams.get('keyword') || '';
  const sort = searchParams.get('sort') || 'created_at DESC';
  const draft = readCatalogDraft(searchParams);
  const { filters, error } = parseCatalogFilters(draft);
  const filterError = error || (!CATALOG_SORTS.includes(sort) ? '请选择有效的商品排序' : undefined);
  const searchScope = JSON.stringify([keyword, sort, draft]);
  const pageValues = searchParams.getAll('page');
  const page = parseCatalogPage(pageValues.length === 1 ? pageValues[0] : pageValues);
  const pageNeedsCorrection = pageValues.length > 0 && (page === 1 || pageValues.length !== 1 || pageValues[0] !== String(page));
  const search = searchParams.toString();
  const scope = JSON.stringify([searchScope, page, search]);
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const correction = useRef<string | null>(null);
  const navigate = useCallback((href: string, replace = false) => {
    // Next may wait for server HTML before committing searchParams. Old results must not
    // replace a newer requested URL while that navigation is still in progress.
    if (new URL(href, window.location.origin).search.slice(1) !== search) currentScope.current = `navigation:${href}`;
    try {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href);
    } catch (error) {
      currentScope.current = scope;
      throw error;
    }
  }, [router, scope, search]);
  const seeded = !filterError && seed && seed.keyword === keyword && seed.sort === sort && JSON.stringify(catalogFilterParams(seed.filters ?? {})) === JSON.stringify(catalogFilterParams(filters)) && seed.list.page === page ? seed.list : undefined;
  const query = useQuery({
    queryKey: ['products', keyword, sort, filters, page, filterError],
    queryFn: () => productApi.list({ keyword, sort, ...filters, page, limit: LIMIT }),
    enabled: !filterError,
    initialData: seeded,
  });
  // Initial browser hydration must read the same server snapshot even when the tab's
  // query cache already contains a different result for this URL.
  const queryData = hydrated ? query.data : seeded;
  const cachedPageMissing = queryData && page > Math.max(1, queryData.totalPages || 0);
  // A cached missing page cannot override a valid server page until its refresh succeeds.
  const waitingForPage = hydrated && cachedPageMissing && seeded && page <= Math.max(1, seeded.totalPages || 0)
    && (query.isFetching || query.isError);
  const result = waitingForPage ? seeded : queryData;
  const lastPage = Math.max(1, result?.totalPages || 0);
  const beyondLastPage = (hydrated ? query.isSuccess : Boolean(seeded)) && page > lastPage;
  const data = beyondLastPage ? undefined : result;
  const products = data?.products || [];
  const totalPages = data?.totalPages || 0;
  // A failed refresh keeps the products already shown; only a search with nothing to show reports the error in place.
  // A retry of such a search is pending again, so it shows the skeleton rather than the old error.
  const loadError = hydrated && !data && query.isError;
  const loading = !filterError && !data && !loadError;
  const pagination = { page, totalPages };

  // Canonicalize malformed pages and recover from catalog shrinkage without adding history entries.
  // Hide an out-of-range response until its replacement page loads.
  useEffect(() => {
    if (currentScope.current !== scope) return;
    if (!beyondLastPage && !pageNeedsCorrection) { correction.current = null; return; }
    const params = new URLSearchParams(search);
    const next = beyondLastPage ? lastPage : page;
    if (next === 1) params.delete('page');
    else params.set('page', String(next));
    const href = `/products${params.size ? `?${params}` : ''}`;
    const key = JSON.stringify([search, href]);
    if (correction.current === key) return;
    correction.current = key;
    navigate(href, true);
  }, [beyondLastPage, pageNeedsCorrection, lastPage, page, search, scope, navigate]);

  useEffect(() => {
    if (!query.error) return;
    logger.error('加载商品失败:', query.error);
    toast.error(translate('加载商品失败'));
  }, [query.error]);

  const handlePageChange = (next: number) => {
    if (currentScope.current !== scope || next < 1 || next > totalPages || next === page) return;
    const params = new URLSearchParams(search);
    if (next === 1) params.delete('page');
    else params.set('page', String(next));
    navigate(`/products${params.size ? `?${params}` : ''}`);
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
                  if (currentScope.current !== scope) return;
                  const params = new URLSearchParams(searchParams);
                  params.set('sort', e.target.value);
                  params.delete('page');
                  navigate(`/products?${params.toString()}`);
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
          <CatalogFilters initial={draft} scope={searchScope} onApply={nextFilters => {
            if (currentScope.current !== scope) return;
            const params = new URLSearchParams(searchParams);
            CATALOG_FILTER_KEYS.forEach(key => params.delete(key));
            Object.entries(catalogFilterParams(nextFilters)).forEach(([key, value]) => params.set(key, value));
            params.delete('page');
            navigate(`/products${params.size ? `?${params}` : ''}`);
          }} />
        </div>

        {/* 商品列表 */}
        {filterError ? (
          <p role="alert" className="py-10 text-center text-red-600">{t(filterError)}</p>
        ) : loading ? (
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
