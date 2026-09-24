'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// 标记为动态页面
export const dynamic = 'force-dynamic';
import { productApi } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

function ProductsList() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  const keyword = searchParams.get('keyword') || '';
  const sort = searchParams.get('sort') || 'created_at DESC';

  useEffect(() => {
    loadProducts();
  }, [keyword, sort, pagination.page]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data: any = await productApi.list({
        keyword,
        sort,
        page: pagination.page,
        limit: pagination.limit,
      });

      setProducts(data.products || []);
      setPagination({
        ...pagination,
        total: data.total,
        totalPages: data.totalPages,
      });
    } catch (error: any) {
      logger.error('加载商品失败:', error);
      toast.error('加载商品失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setPagination({ ...pagination, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="py-8">
      <div className="container-custom">
        {/* 头部 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">
            {keyword ? `搜索结果: ${keyword}` : '全部商品'}
          </h1>
          
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              共找到 <span className="text-primary-600 font-medium">{pagination.total}</span> 件商品
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">排序:</span>
              <select
                value={sort}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('sort', e.target.value);
                  window.location.href = `/products?${params.toString()}`;
                }}
                className="input w-auto"
              >
                <option value="created_at DESC">最新</option>
                <option value="sales_count DESC">最热</option>
                <option value="price ASC">价格从低到高</option>
                <option value="price DESC">价格从高到低</option>
              </select>
            </div>
          </div>
        </div>

        {/* 商品列表 */}
        {loading ? (
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
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-medium text-gray-900 mb-2">暂无商品</h3>
            <p className="text-gray-600">换个关键词试试吧</p>
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
                    上一页
                  </button>
                  
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
                    下一页
                  </button>
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

