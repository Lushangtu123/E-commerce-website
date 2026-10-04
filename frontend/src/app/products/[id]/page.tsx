'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { productApi, cartApi, reviewApi, favoriteApi, browseApi, recommendationApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiShoppingCart, FiStar } from 'react-icons/fi';
import { FaHeart, FaRegHeart } from 'react-icons/fa';
import ProductCard from '@/components/ProductCard';
import { logger } from '@/lib/logger';

export default function ProductDetailPage() {
  const { t, formatDate } = useI18n();
  const params = useParams() || {};
  const router = useRouter();
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const { addItem } = useCartStore();
  
  const [product, setProduct] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  const [selectedSkuId, setSelectedSkuId] = useState<number | undefined>(undefined);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const mounted = useRef(true);
  const addingRequest = useRef<string | null>(null);
  const productId = parseInt(params.id as string);
  const context = JSON.stringify([productId, token, user?.user_id, isAuthenticated]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const isCurrentContext = () => {
    const auth = useAuthStore.getState();
    return mounted.current && currentContext.current === context &&
      auth.isAuthenticated === isAuthenticated && auth.token === token && auth.user?.user_id === user?.user_id &&
      localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isHydrated || !productId) return;
    let active = true;
    const isCurrentRequest = () => active && isCurrentContext();
    setLoading(true);
    setProduct(null);
    setLoadedContext(null);
    setReviews([]);
    setRelatedProducts([]);
    setQuantity(1);
    setSelectedSkuId(undefined);
    setAdding(false);
    addingRequest.current = null;
    setIsFavorited(false);
    setFavoriting(false);
    productApi.getDetail(productId).then((data: any) => {
      if (!isCurrentRequest()) return;
      setProduct(data.product);
      setLoadedContext(context);
    }).catch((error: any) => {
      if (!isCurrentRequest()) return;
      logger.error('加载商品失败:', error);
      toast.error(t("商品不存在"));
      router.push('/products');
    }).finally(() => { if (isCurrentRequest()) setLoading(false); });
    reviewApi.listByProduct(productId, { limit: 5 }).then((data: any) => {
      if (isCurrentRequest()) setReviews(data.reviews || []);
    }).catch((error: any) => { if (isCurrentRequest()) logger.error('加载评论失败:', error); });
    setLoadingRecommendations(true);
    recommendationApi.getRelated(productId, 4).then((data: any) => {
      if (isCurrentRequest()) setRelatedProducts(data.related_products || []);
    }).catch((error: any) => { if (isCurrentRequest()) logger.error('加载相关推荐失败:', error); })
      .finally(() => { if (isCurrentRequest()) setLoadingRecommendations(false); });
    if (isAuthenticated) {
      favoriteApi.check(productId).then((data: any) => {
        if (isCurrentRequest()) setIsFavorited(data.is_favorited);
      }).catch((error: any) => { if (isCurrentRequest()) logger.error('检查收藏状态失败:', error); });
      browseApi.record(productId).catch((error: any) => { if (isCurrentRequest()) logger.error('记录浏览历史失败:', error); });
    }
    return () => { active = false; };
  }, [isHydrated, productId, isAuthenticated, token, user?.user_id, router]);

  const hasSku = !!product?.has_sku;
  const skus: any[] = product?.skus || [];
  const selectedSku = skus.find(sku => sku.sku_id === selectedSkuId);
  const stock = Number(hasSku ? selectedSku?.stock ?? 0 : product?.stock ?? 0);
  const price = selectedSku?.price ?? product?.price;
  const image = selectedSku?.image || product?.main_image;
  const canPurchase = !hasSku || !!selectedSku;
  const soldOut = hasSku ? (selectedSku ? stock <= 0 : !skus.some(sku => Number(sku.stock) > 0)) : stock <= 0;

  const handleAddToCart = async (): Promise<boolean> => {
    if (!isHydrated || !isCurrentContext() || loadedContext !== context || addingRequest.current) return false;
    if (!isAuthenticated) {
      toast.error(t("请先登录"));
      router.push('/login');
      return false;
    }
    if (!canPurchase) {
      toast.error(t("请选择商品规格"));
      return false;
    }
    if (quantity < 1 || quantity > stock) {
      toast.error(t("商品库存不足"));
      return false;
    }
    addingRequest.current = context;
    setAdding(true);
    try {
      await cartApi.add({ product_id: productId, quantity, ...(selectedSku && { sku_id: selectedSku.sku_id }) });
      if (!isCurrentContext()) return false;
      addItem({
        cart_id: Date.now(), product_id: productId, quantity, title: product.title,
        price: Number(price), main_image: image, stock,
        ...(selectedSku && { sku_id: selectedSku.sku_id, sku_code: selectedSku.sku_code, sku_specs: selectedSku.specs }),
      });
      toast.success(t("已加入购物车"));
      return true;
    } catch (error: any) {
      if (isCurrentContext()) toast.error(t(error.response?.data?.error || "加入购物车失败"));
      return false;
    } finally {
      if (isCurrentContext()) {
        addingRequest.current = null;
        setAdding(false);
      }
    }
  };

  const handleBuyNow = async () => {
    if (await handleAddToCart() && isCurrentContext()) router.push('/cart');
  };

  const handleToggleFavorite = async () => {
    if (!isHydrated || !isCurrentContext() || favoriting) return;
    if (!isAuthenticated) {
      toast.error(t("请先登录"));
      router.push('/login');
      return;
    }
    setFavoriting(true);
    try {
      const data: any = await favoriteApi.toggle(productId);
      if (!isCurrentContext()) return;
      setIsFavorited(data.is_favorited);
      toast.success(t(data.message));
    } catch (error: any) {
      if (isCurrentContext()) toast.error(t(error.response?.data?.message || "操作失败"));
    } finally {
      if (isCurrentContext()) setFavoriting(false);
    }
  };

  if (!isHydrated || loading || loadedContext !== context) {
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
              {image ? (
                <img
                  src={image}
                  alt={product.title}
                  className="w-full h-96 object-contain"
                />
              ) : (
                <div className="w-full h-96 flex items-center justify-center text-gray-400">
                  {t("暂无图片")}</div>
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
                  <span>{t('{rating} 分', { rating: product.rating })}</span>
                </div>
                <div>{t('已售 {count} 件', { count: product.sales_count })}</div>
                <div>{t('库存 {count} 件', { count: hasSku && !selectedSku ? product.stock : stock })}</div>
              </div>

              <div className="bg-primary-50 p-6 rounded-lg">
                <div className="flex items-baseline space-x-3">
                  <span className="text-primary-600 text-4xl font-bold">
                    ¥{price}
                  </span>
                  {product.original_price && product.original_price > Number(price) && (
                    <span className="text-gray-400 text-xl line-through">
                      ¥{product.original_price}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {hasSku && (
              <div>
                <label htmlFor="product-sku" className="block text-gray-700 mb-2">{t("商品规格")}</label>
                <select
                  id="product-sku"
                  value={selectedSkuId ?? ''}
                  disabled={adding || skus.length === 0}
                  onChange={event => { setSelectedSkuId(event.target.value ? Number(event.target.value) : undefined); setQuantity(1); }}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option value="">{skus.length === 0 ? t("暂无可用规格") : t("请选择规格")}</option>
                  {skus.map(sku => (
                    <option key={sku.sku_id} value={sku.sku_id} disabled={Number(sku.stock) <= 0}>
                      {Object.entries(sku.specs || {}).map(([name, value]) => `${name}: ${value}`).join(' / ') || sku.sku_code}
                      {t(' — ¥{price}（库存 {stock}）', { price: sku.price, stock: sku.stock })}
                    </option>
                  ))}
                </select>
                {selectedSku && <p className="text-sm text-gray-500 mt-2">{t('规格编号：{code}', { code: selectedSku.sku_code })}</p>}
              </div>
            )}

            {/* 数量选择 */}
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">{t("数量:")}</span>
              <div className="flex items-center border border-gray-300 rounded">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={adding || !canPurchase || quantity <= 1}
                  className="px-4 py-2 hover:bg-gray-100"
                >
                  -
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(Math.max(1, stock), Math.max(1, parseInt(e.target.value) || 1)))}
                  disabled={adding || !canPurchase || soldOut}
                  className="w-20 text-center border-x border-gray-300 py-2"
                  min="1"
                  max={stock}
                />
                <button
                  onClick={() => setQuantity(Math.min(stock, quantity + 1))}
                  disabled={adding || !canPurchase || quantity >= stock}
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
                title={isFavorited ? t("取消收藏") : t("收藏")}
              >
                {isFavorited ? <FaHeart size={24} /> : <FaRegHeart size={24} />}
              </button>
              
              <button
                onClick={handleAddToCart}
                disabled={adding || !canPurchase || soldOut}
                className="flex-1 btn btn-outline disabled:opacity-50"
              >
                <FiShoppingCart className="inline mr-2" />
                {soldOut ? t("已售罄") : adding ? t("加入中...") : t("加入购物车")}
              </button>
              <button
                onClick={handleBuyNow}
                disabled={adding || !canPurchase || soldOut}
                className="flex-1 btn btn-primary disabled:opacity-50"
              >
                {soldOut ? t("已售罄") : t("立即购买")}
              </button>
            </div>

            {/* 商品描述 */}
            <div className="border-t pt-6">
              <h3 className="font-bold text-lg mb-3">{t("商品详情")}</h3>
              <p className="text-gray-600 whitespace-pre-wrap">
                {product.description || t("暂无描述")}
              </p>
            </div>
          </div>
        </div>

        {/* 评论区 */}
        <div className="card p-6">
          <h2 className="text-2xl font-bold mb-6">{t("用户评价")}</h2>
          
          {reviews.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {t("暂无评价")}</div>
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
                        <span>{formatDate(review.created_at, true)}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-700 ml-13">{review.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 相关推荐 */}
        {relatedProducts.length > 0 && (
          <div className="card p-6">
            <h2 className="text-2xl font-bold mb-6">{t("相关推荐")}</h2>
            
            {loadingRecommendations ? (
              <div className="text-center py-12 text-gray-500">
                {t("加载中...")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {relatedProducts.map((relatedProduct) => (
                  <ProductCard key={relatedProduct.product_id} product={relatedProduct} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

