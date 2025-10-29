'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { favoriteApi, cartApi } from '@/lib/api';
import { toast } from 'react-hot-toast';
import { FaHeart, FaShoppingCart, FaTrash } from 'react-icons/fa';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

interface FavoriteProduct {
  favorite_id: number;
  product_id: number;
  title: string;
  price: number;
  original_price?: number;
  main_image?: string;
  stock: number;
  status: number;
  created_at: string;
}

export default function FavoritesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { fetchCartCount } = useCartStore();
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    fetchFavorites();
  }, [user, page]);

  const fetchFavorites = async () => {
    try {
      setLoading(true);
      const data: any = await favoriteApi.list({ page, limit });
      setFavorites(data.favorites || []);
      setTotal(data.pagination?.total || 0);
    } catch (error: any) {
      toast.error(error.response?.data?.message || '获取收藏列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (productId: number) => {
    try {
      await favoriteApi.remove(productId);
      toast.success('取消收藏成功');
      fetchFavorites();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '取消收藏失败');
    }
  };

  const handleAddToCart = async (productId: number, stock: number) => {
    if (stock <= 0) {
      toast.error('商品已售罄');
      return;
    }
    
    try {
      await cartApi.add({ product_id: productId, quantity: 1 });
      toast.success('已添加到购物车');
      fetchCartCount();
    } catch (error: any) {
      toast.error(error.response?.data?.message || '添加失败');
    }
  };

  const handleProductClick = (productId: number) => {
    router.push(`/products/${productId}`);
  };

  if (loading) {
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <FaHeart className="text-red-500" />
            我的收藏
          </h1>
          <p className="text-gray-600 mt-2">共 {total} 个商品</p>
        </div>

        {favorites.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <FaHeart className="text-6xl text-gray-300 mx-auto mb-4" />
            <p className="text-xl text-gray-600 mb-4">暂无收藏商品</p>
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
              {favorites.map((item) => (
                <div
                  key={item.favorite_id}
                  className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition group"
                >
                  <div
                    className="relative cursor-pointer"
                    onClick={() => handleProductClick(item.product_id)}
                  >
                    <img
                      src={item.main_image || '/placeholder.png'}
                      alt={item.title}
                      className="w-full h-64 object-cover group-hover:scale-105 transition duration-300"
                    />
                    {item.stock <= 0 && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                        <span className="text-white text-xl font-bold">已售罄</span>
                      </div>
                    )}
                    {item.status === 0 && (
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
                      {item.title}
                    </h3>

                    <div className="flex items-baseline gap-2 mb-4">
                      <span className="text-2xl font-bold text-red-600">
                        ¥{item.price}
                      </span>
                      {item.original_price && item.original_price > item.price && (
                        <span className="text-sm text-gray-400 line-through">
                          ¥{item.original_price}
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddToCart(item.product_id, item.stock)}
                        disabled={item.stock <= 0 || item.status === 0}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        <FaShoppingCart />
                        加入购物车
                      </button>
                      <button
                        onClick={() => handleRemove(item.product_id)}
                        className="p-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition"
                        title="取消收藏"
                      >
                        <FaTrash />
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
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="px-4 py-2 text-gray-600">
                  {page} / {Math.ceil(total / limit)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(total / limit)}
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

