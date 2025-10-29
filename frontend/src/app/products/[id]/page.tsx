'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { productApi, cartApi, reviewApi, favoriteApi, browseApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiShoppingCart, FiStar } from 'react-icons/fi';
import { FaHeart, FaRegHeart } from 'react-icons/fa';

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { addItem } = useCartStore();
  
  const [product, setProduct] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriting, setFavoriting] = useState(false);

  const productId = parseInt(params.id as string);

  useEffect(() => {
    if (productId) {
      loadProduct();
      loadReviews();
      if (isAuthenticated) {
        checkFavoriteStatus();
        recordBrowse();
      }
    }
  }, [productId, isAuthenticated]);

  const recordBrowse = async () => {
    try {
      await browseApi.record(productId);
    } catch (error) {
      // 静默失败，不影响用户体验
      console.error('记录浏览历史失败:', error);
    }
  };

  const loadProduct = async () => {
    try {
      const data: any = await productApi.getDetail(productId);
      setProduct(data.product);
    } catch (error: any) {
      console.error('加载商品失败:', error);
      toast.error('商品不存在');
      router.push('/products');
    } finally {
      setLoading(false);
    }
  };

  const loadReviews = async () => {
    try {
      const data: any = await reviewApi.listByProduct(productId, { limit: 5 });
      setReviews(data.reviews || []);
    } catch (error) {
      console.error('加载评论失败:', error);
    }
  };

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      toast.error('请先登录');
      router.push('/login');
      return;
    }

    setAdding(true);
    try {
      await cartApi.add({ product_id: productId, quantity });
      addItem({
        cart_id: Date.now(),
        product_id: productId,
        quantity,
        title: product.title,
        price: product.price,
        main_image: product.main_image,
        stock: product.stock,
      });
      toast.success('已加入购物车');
    } catch (error: any) {
      toast.error(error.response?.data?.error || '加入购物车失败');
    } finally {
      setAdding(false);
    }
  };

  const handleBuyNow = async () => {
    await handleAddToCart();
    router.push('/cart');
  };

  const checkFavoriteStatus = async () => {
    try {
      const data: any = await favoriteApi.check(productId);
      setIsFavorited(data.is_favorited);
    } catch (error) {
      console.error('检查收藏状态失败:', error);
    }
  };

  const handleToggleFavorite = async () => {
    if (!isAuthenticated) {
      toast.error('请先登录');
      router.push('/login');
      return;
    }

    setFavoriting(true);
    try {
      const data: any = await favoriteApi.toggle(productId);
      setIsFavorited(data.is_favorited);
      toast.success(data.message);
    } catch (error: any) {
      toast.error(error.response?.data?.message || '操作失败');
    } finally {
      setFavoriting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8">
        <div className="container-custom">
          <div className="animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-gray-300 h-96 rounded-lg"></div>
              <div className="space-y-4">
                <div className="h-8 bg-gray-300 rounded w-3/4"></div>
                <div className="h-6 bg-gray-300 rounded w-1/2"></div>
                <div className="h-32 bg-gray-300 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return null;
  }

  return (
    <div className="py-8">
      <div className="container-custom">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          {/* 商品图片 */}
          <div className="card p-4">
            <div className="bg-gray-100 rounded-lg overflow-hidden">
              {product.main_image ? (
                <img
                  src={product.main_image}
                  alt={product.title}
                  className="w-full h-96 object-contain"
                />
              ) : (
                <div className="w-full h-96 flex items-center justify-center text-gray-400">
                  暂无图片
                </div>
              )}
            </div>
          </div>

          {/* 商品信息 */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                {product.title}
              </h1>
              
              <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                <div className="flex items-center">
                  <FiStar className="text-yellow-400 mr-1" />
                  <span>{product.rating} 分</span>
                </div>
                <div>已售 {product.sales_count} 件</div>
                <div>库存 {product.stock} 件</div>
              </div>

              <div className="bg-primary-50 p-6 rounded-lg">
                <div className="flex items-baseline space-x-3">
                  <span className="text-primary-600 text-4xl font-bold">
                    ¥{product.price}
                  </span>
                  {product.original_price && product.original_price > product.price && (
                    <span className="text-gray-400 text-xl line-through">
                      ¥{product.original_price}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 数量选择 */}
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">数量:</span>
              <div className="flex items-center border border-gray-300 rounded">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 py-2 hover:bg-gray-100"
                >
                  -
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 text-center border-x border-gray-300 py-2"
                  min="1"
                  max={product.stock}
                />
                <button
                  onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                  className="px-4 py-2 hover:bg-gray-100"
                >
                  +
                </button>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex space-x-4">
              <button
                onClick={handleToggleFavorite}
                disabled={favoriting}
                className={`px-6 py-3 rounded-lg border transition ${
                  isFavorited
                    ? 'border-red-500 bg-red-50 text-red-500 hover:bg-red-100'
                    : 'border-gray-300 text-gray-600 hover:border-red-500 hover:text-red-500'
                }`}
                title={isFavorited ? '取消收藏' : '收藏'}
              >
                {isFavorited ? <FaHeart size={24} /> : <FaRegHeart size={24} />}
              </button>
              
              <button
                onClick={handleAddToCart}
                disabled={adding || product.stock === 0}
                className="flex-1 btn btn-outline disabled:opacity-50"
              >
                <FiShoppingCart className="inline mr-2" />
                {product.stock === 0 ? '已售罄' : adding ? '加入中...' : '加入购物车'}
              </button>
              <button
                onClick={handleBuyNow}
                disabled={adding || product.stock === 0}
                className="flex-1 btn btn-primary disabled:opacity-50"
              >
                {product.stock === 0 ? '已售罄' : '立即购买'}
              </button>
            </div>

            {/* 商品描述 */}
            <div className="border-t pt-6">
              <h3 className="font-bold text-lg mb-3">商品详情</h3>
              <p className="text-gray-600 whitespace-pre-wrap">
                {product.description || '暂无描述'}
              </p>
            </div>
          </div>
        </div>

        {/* 评论区 */}
        <div className="card p-6">
          <h2 className="text-2xl font-bold mb-6">用户评价</h2>
          
          {reviews.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              暂无评价
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.review_id} className="border-b pb-4 last:border-0">
                  <div className="flex items-center mb-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-medium mr-3">
                      {review.username?.[0]}
                    </div>
                    <div>
                      <div className="font-medium">{review.username}</div>
                      <div className="flex items-center text-sm text-gray-500">
                        <div className="flex text-yellow-400 mr-2">
                          {[...Array(5)].map((_, i) => (
                            <FiStar
                              key={i}
                              className={i < review.rating ? 'fill-current' : ''}
                            />
                          ))}
                        </div>
                        <span>{new Date(review.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-700 ml-13">{review.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

