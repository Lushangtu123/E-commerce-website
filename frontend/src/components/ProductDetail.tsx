'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { productApi, cartApi, reviewApi, favoriteApi, browseApi, recommendationApi, type Product, type ProductReview } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiHeart, FiShoppingCart } from 'react-icons/fi';
import { FaHeart, FaStar } from 'react-icons/fa';
import ProductImage from '@/components/ProductImage';
import ProductReviewList from '@/components/ProductReviewList';
import RelatedProducts from '@/components/RelatedProducts';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';

/**
 * The product page. The server renders `initialProduct` so the HTML carries the product; the
 * client then loads it again for the signed-in context, and only that copy can be bought.
 */
export default function ProductDetail({ initialProduct = null }: { initialProduct?: Product | null }) {
  const { t } = useI18n();
  const params = useParams() || {};
  const router = useRouter();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const { addItem } = useCartStore();
  
  const [loadedProduct, setLoadedProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
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
  const context = JSON.stringify([productId, sessionId, user?.user_id, isAuthenticated]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const isCurrentContext = () => {
    const auth = useAuthStore.getState();
    return mounted.current && currentContext.current === context &&
      auth.isAuthenticated === isAuthenticated && auth.sessionId === sessionId && auth.user?.user_id === user?.user_id &&
      storedSessionId() === (sessionId ?? null);
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
    setLoadedProduct(null);
    setLoadedContext(null);
    setReviews([]);
    setRelatedProducts([]);
    setQuantity(1);
    setSelectedSkuId(undefined);
    setAdding(false);
    addingRequest.current = null;
    setIsFavorited(false);
    setFavoriting(false);
    productApi.getDetail(productId).then((data) => {
      if (!isCurrentRequest()) return;
      setLoadedProduct(data.product);
      setLoadedContext(context);
    }).catch((error) => {
      if (!isCurrentRequest()) return;
      logger.error('加载商品失败:', error);
      const status = requestFailure(error).response?.status;
      // The server copy stays readable, with its controls locked, through a failure that does not say the product is gone.
      if (initialProduct?.product_id === productId && status !== 404 && status !== 400) {
        toast.error(t('加载商品失败'));
        return;
      }
      toast.error(t("商品不存在"));
      router.push('/products');
    }).finally(() => { if (isCurrentRequest()) setLoading(false); });
    reviewApi.listByProduct(productId, { limit: 5 }).then((data) => {
      if (isCurrentRequest()) setReviews(data.reviews || []);
    }).catch((error) => { if (isCurrentRequest()) logger.error('加载评论失败:', error); });
    setLoadingRecommendations(true);
    recommendationApi.getRelated(productId, 4).then((data) => {
      if (isCurrentRequest()) setRelatedProducts(data.related_products || []);
    }).catch((error) => { if (isCurrentRequest()) logger.error('加载相关推荐失败:', error); })
      .finally(() => { if (isCurrentRequest()) setLoadingRecommendations(false); });
    if (isAuthenticated) {
      favoriteApi.check(productId).then((data) => {
        if (isCurrentRequest()) setIsFavorited(data.is_favorited);
      }).catch((error) => { if (isCurrentRequest()) logger.error('检查收藏状态失败:', error); });
      browseApi.record(productId).catch((error) => { if (isCurrentRequest()) logger.error('记录浏览历史失败:', error); });
    }
    return () => { active = false; };
  }, [isHydrated, productId, isAuthenticated, sessionId, user?.user_id, router]);

  // Until the client has loaded the product for this context, show the server's copy with every control locked.
  const ready = isHydrated && !loading && loadedContext === context;
  const product = ready ? loadedProduct : initialProduct?.product_id === productId ? initialProduct : null;
  const locked = adding || !ready;
  const hasSku = !!product?.has_sku;
  const skus = product?.skus || [];
  const selectedSku = skus.find(sku => sku.sku_id === selectedSkuId);
  const stock = Number(hasSku ? selectedSku?.stock ?? 0 : product?.stock ?? 0);
  const price = selectedSku?.price ?? product?.price;
  const image = selectedSku?.image || product?.main_image;
  const canPurchase = !hasSku || !!selectedSku;
  const soldOut = hasSku ? (selectedSku ? stock <= 0 : !skus.some(sku => Number(sku.stock) > 0)) : stock <= 0;

  const handleAddToCart = async (): Promise<boolean> => {
    if (!product || !ready || !isCurrentContext() || addingRequest.current) return false;
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
        price: Number(price), main_image: image ?? undefined, stock,
        ...(selectedSku && { sku_id: selectedSku.sku_id, sku_code: selectedSku.sku_code, sku_specs: selectedSku.specs }),
      });
      toast.success(t("已加入购物车"));
      return true;
    } catch (error) {
      if (isCurrentContext()) toast.error(t(requestFailure(error).response?.data?.error || "加入购物车失败"));
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
    if (!ready || !isCurrentContext() || favoriting) return;
    if (!isAuthenticated) {
      toast.error(t("请先登录"));
      router.push('/login');
      return;
    }
    setFavoriting(true);
    try {
      const data = await favoriteApi.toggle(productId);
      if (!isCurrentContext()) return;
      setIsFavorited(data.is_favorited);
      toast.success(t(data.message));
    } catch (error) {
      if (isCurrentContext()) toast.error(t(requestFailure(error).response?.data?.message || "操作失败"));
    } finally {
      if (isCurrentContext()) setFavoriting(false);
    }
  };

  if (!product) {
    return (
      // Same element tree as the loaded layout below, so the grid is updated in place
      // instead of being replaced (a replaced grid counts as a large layout shift).
      <div className="py-10">
        <div className="container-custom">
          <div className="mb-12 grid animate-pulse grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12" aria-busy="true">
            <div className="aspect-square rounded-2xl bg-gray-100"></div>
            <div className="space-y-4">
              <div className="h-8 w-3/4 rounded bg-gray-100"></div>
              <div className="h-5 w-1/2 rounded bg-gray-100"></div>
              <div className="h-24 rounded-xl bg-gray-100"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10">
      <div className="container-custom">
        <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
          {/* 商品图片 */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <ProductImage src={image} alt={product.title} className="aspect-square" fit="contain" priority />
          </div>

          {/* 商品信息 */}
          <div className="space-y-6">
            <div>
              <h1 className="mb-3 text-2xl font-semibold tracking-tight text-gray-900 md:text-3xl">
                {product.title}
              </h1>
              
              <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                <div className="flex items-center">
                  <FaStar className="mr-1 h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  <span>{t('{rating} 分', { rating: product.rating })}</span>
                </div>
                <div>{t('已售 {count} 件', { count: product.sales_count })}</div>
                <div>{t('库存 {count} 件', { count: hasSku && !selectedSku ? product.stock : stock })}</div>
              </div>

              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-semibold text-primary-600">
                    ¥{price}
                  </span>
                  {Number(product.original_price) > Number(price) && (
                    <span className="text-base text-gray-500 line-through">
                      ¥{product.original_price}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {hasSku && (
              <div>
                <label htmlFor="product-sku" className="mb-2 block text-sm font-medium text-gray-900">{t("商品规格")}</label>
                <select
                  id="product-sku"
                  value={selectedSkuId ?? ''}
                  disabled={locked || skus.length === 0}
                  onChange={event => { setSelectedSkuId(event.target.value ? Number(event.target.value) : undefined); setQuantity(1); }}
                  className="input"
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
            <div className="flex items-center gap-4">
              <label htmlFor="product-quantity" className="text-sm font-medium text-gray-900">{t("数量:")}</label>
              <div className="flex items-center overflow-hidden rounded-lg border border-gray-300">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={locked || !canPurchase || quantity <= 1}
                  className="h-10 w-10 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  -
                </button>
                <input
                  id="product-quantity"
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(Math.max(1, stock), Math.max(1, parseInt(e.target.value) || 1)))}
                  disabled={locked || !canPurchase || soldOut}
                  className="h-10 w-16 border-x border-gray-300 text-center text-sm"
                  min="1"
                  max={stock}
                />
                <button
                  onClick={() => setQuantity(Math.min(stock, quantity + 1))}
                  disabled={locked || !canPurchase || quantity >= stock}
                  className="h-10 w-10 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  +
                </button>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={handleToggleFavorite}
                disabled={favoriting || !ready}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  isFavorited
                    ? 'border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100'
                    : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-900'
                }`}
                title={isFavorited ? t("取消收藏") : t("收藏")}
                aria-label={isFavorited ? t("取消收藏") : t("收藏")}
              >
                {isFavorited ? <FaHeart size={20} /> : <FiHeart size={20} />}
              </button>
              
              <button
                onClick={handleAddToCart}
                disabled={locked || !canPurchase || soldOut}
                className="flex-1 btn btn-outline inline-flex h-12 items-center justify-center gap-2 disabled:opacity-50"
              >
                <FiShoppingCart aria-hidden="true" />
                {soldOut ? t("已售罄") : adding ? t("加入中...") : t("加入购物车")}
              </button>
              <button
                onClick={handleBuyNow}
                disabled={locked || !canPurchase || soldOut}
                className="flex-1 btn btn-primary h-12 disabled:opacity-50"
              >
                {soldOut ? t("已售罄") : t("立即购买")}
              </button>
            </div>

            {/* 商品描述 */}
            <div className="border-t border-gray-200 pt-6">
              <h2 className="mb-3 text-base font-semibold text-gray-900">{t("商品详情")}</h2>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">
                {product.description || t("暂无描述")}
              </p>
            </div>
          </div>
        </div>

        <ProductReviewList reviews={reviews} />

        <RelatedProducts products={relatedProducts} loading={loadingRecommendations} />
      </div>
    </div>
  );
}

