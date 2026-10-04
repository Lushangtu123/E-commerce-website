'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// 标记为动态页面
export const dynamic = 'force-dynamic';
import { productApi } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

function ProductsList() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const keyword = searchParams.get('keyword') || '';
  const sort = searchParams.get('sort') || 'created_at DESC';
  const [result, setResult] = useState<{ scope: string | null; rows: any[] }>({ scope: null, rows: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pageState, setPagination] = useState({
    keyword,
    sort,
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  const matchesQuery = pageState.keyword === keyword && pageState.sort === sort;
  const pagination = { ...pageState, page: matchesQuery ? pageState.page : 1,
    total: matchesQuery ? pageState.total : 0, totalPages: matchesQuery ? pageState.totalPages : 0 };
  const scope = JSON.stringify([keyword, sort, pagination.page]);
  const products = result.scope === scope ? result.rows : [];
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestRevision = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestRevision.current += 1; };
  }, []);

  useEffect(() => {
    setPagination(previous => previous.keyword === keyword && previous.sort === sort ? previous :
      { ...previous, keyword, sort, page: 1, total: 0, totalPages: 0 });
  }, [keyword, sort]);

  useEffect(() => {
    loadProducts();
  }, [keyword, sort, pagination.page]);

  const loadProducts = async () => {
    if (!mounted.current || currentScope.current !== scope) return;
    const request = ++requestRevision.current;
    const isCurrent = () => mounted.current && request === requestRevision.current && currentScope.current === scope;
    try {
      setLoading(true);
      setLoadError(false);
      const data: any = await productApi.list({
        keyword,
        sort,
        page: pagination.page,
        limit: pagination.limit,
      });

      if (!isCurrent()) return;
      setResult({ scope, rows: data.products || [] });
      setPagination({
        ...pagination,
        keyword,
        sort,
        total: data.total,
        totalPages: data.totalPages,
      });
    } catch (error: any) {
      if (!isCurrent()) return;
      setResult({ scope, rows: [] });
      setLoadError(true);
      logger.error('加载商品失败:', error);
      toast.error(t("加载商品失败"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    if (!mounted.current || currentScope.current !== scope || result.scope !== scope || loading || loadError ||
      page < 1 || page > pagination.totalPages || page === pagination.page) return;
    setPagination({ ...pagination, keyword, sort, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="py-8">
      <div className="container-custom">
        {/* 头部 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">
            {keyword ? t('搜索结果: {keyword}', { keyword }) : t("全部商品")}
          </h1>
          
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              {t('共找到 {count} 件商品', { count: loading || loadError || result.scope !== scope ? '—' : pagination.total })}</div>
            
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">{t("排序:")}</span>
              <select
                value={sort}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('sort', e.target.value);
                  params.delete('page');
                  router.push(`/products?${params.toString()}`);
                }}
                className="input w-auto"
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
        {loading || result.scope !== scope ? (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="bg-gray-300 h-64 w-full"></div>
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-300 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-20" role="alert">
            <p className="text-red-600">{t('加载商品失败')}</p>
            <button onClick={loadProducts} className="btn btn-secondary mt-4">{t('重新加载')}</button>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-medium text-gray-900 mb-2">{t("暂无商品")}</h3>
            <p className="text-gray-600">{t("换个关键词试试吧")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
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
                      return <span key={page}>...</span>;
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

export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="py-8">
        <div className="container-custom">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="bg-gray-300 h-64 w-full"></div>
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-300 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    }>
      <ProductsList />
    </Suspense>
  );
}
