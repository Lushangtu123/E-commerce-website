'use client';

import { useRouter } from 'next/navigation';
import { browseApi } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { FiClock, FiShoppingCart, FiTrash } from 'react-icons/fi';
import { canBuyActivityProduct, useCustomerActivity } from '@/hooks/use-customer-activity';
import { quickAddToCart } from '@/lib/quick-cart';

interface BrowseHistory {
  id: number;
  product_id: number;
  title: string | null;
  price: number | string | null;
  main_image?: string | null;
  stock: number | string | null;
  has_sku?: boolean | number;
  status: number | null;
  browsed_at: string;
}

export default function BrowseHistoryPage() {
  const router = useRouter();
  const { user, isHydrated, rows: history, loading, page, total, totalPages, limit,
    error: loadError, reload: fetchHistory, goToPage, isCurrentScope, hasDisplayedRow, busy, runMutation } =
    useCustomerActivity<BrowseHistory>('history', browseApi.getHistory, '获取浏览历史失败');

  const handleRemove = (productId: number) => runMutation(() => browseApi.deleteRecord(productId), {
    productId, refresh: true,
    onSuccess: () => toast.success('删除成功'),
    onError: error => toast.error(error.response?.data?.message || '删除失败'),
  });

  const handleClearAll = () => runMutation(() => browseApi.clearHistory(), {
    confirm: () => confirm('确定要清空所有浏览历史吗？'), refresh: true,
    onSuccess: () => toast.success('已清空浏览历史'),
    onError: error => toast.error(error.response?.data?.message || '清空失败'),
  });

  const handleAddToCart = async (productId: number) => {
    const product = history.find(item => item.product_id === productId);
    if (!product || !canBuyActivityProduct(product)) return;
    return runMutation(() => quickAddToCart(productId, isCurrentScope), {
      productId,
      onSuccess: result => {
        if (result === 'select') router.push(`/products/${productId}`);
        if (result === 'added') toast.success('已添加到购物车');
      },
      onError: error => toast.error(error.response?.data?.error || error.message || '添加失败'),
    });
  };

  const handleProductClick = (productId: number) => {
    if (hasDisplayedRow(productId)) router.push(`/products/${productId}`);
  };

  if (!isHydrated || !user || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <FiClock className="text-blue-600" />
              浏览历史
            </h1>
            <p className="text-gray-600 mt-2">最近浏览了 {loadError ? '—' : total} 个商品</p>
          </div>
          
          {history.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={busy}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition flex items-center gap-2"
            >
              <FiTrash />
              清空历史
            </button>
          )}
        </div>

        {loadError ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center" role="alert">
            <p className="text-red-600">{loadError}</p>
            <button onClick={fetchHistory} className="mt-4 px-4 py-2 border rounded-lg">重新加载</button>
          </div>
        ) : history.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <FiClock className="text-6xl text-gray-300 mx-auto mb-4" />
            <p className="text-xl text-gray-600 mb-4">暂无浏览记录</p>
            <button
              onClick={() => router.push('/products')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              去逛逛
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition group"
                >
                  <div
                    className="relative cursor-pointer"
                    onClick={() => handleProductClick(item.product_id)}
                  >
                    {item.main_image ? <img
                      src={item.main_image}
                      alt={item.title || '商品已不存在'}
                      className="w-full h-64 object-cover group-hover:scale-105 transition duration-300"
                    /> : <div className="w-full h-64 bg-gray-100 flex items-center justify-center text-gray-400">暂无图片</div>}
                    {Number(item.stock) <= 0 && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                        <span className="text-white text-xl font-bold">已售罄</span>
                      </div>
                    )}
                    {item.status !== 1 && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                        <span className="text-white text-xl font-bold">已下架</span>
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <h3
                      className="font-medium text-gray-900 mb-2 line-clamp-2 cursor-pointer hover:text-blue-600"
                      onClick={() => handleProductClick(item.product_id)}
                    >
                      {item.title || '商品已不存在'}
                    </h3>

                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-2xl font-bold text-red-600">
                        ¥{item.price ?? 0}
                      </span>
                    </div>

                    <div className="text-xs text-gray-400 mb-4">
                      浏览时间：{new Date(item.browsed_at).toLocaleString('zh-CN')}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddToCart(item.product_id)}
                        disabled={busy || !canBuyActivityProduct(item)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        <FiShoppingCart />
                        {item.has_sku ? '选择规格' : '加入购物车'}
                      </button>
                      <button
                        onClick={() => handleRemove(item.product_id)}
                        disabled={busy}
                        className="p-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition"
                        title="删除记录"
                      >
                        <FiTrash />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 分页 */}
            {total > limit && (
              <div className="mt-8 flex justify-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="px-4 py-2 text-gray-600">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
