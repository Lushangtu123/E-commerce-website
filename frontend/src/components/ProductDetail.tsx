'use client';

import { translate, useI18n } from '@/lib/i18n';
import { localizedText, localizedSpecs, specSummary, specValue } from '@/lib/product-content';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { productApi, reviewApi, favoriteApi, browseApi, recommendationApi, type Product, type ProductReview } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { addToCart } from '@/lib/cart-add';
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
  const { t, locale } = useI18n();
  const params = useParams() || {};
  const router = useRouter();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  
  const [loadedProduct, setLoadedProduct] = useState<Product | null>(null);
  const [reviewView, setReviewView] = useState<{ context: string; page: number; revision: number } | null>(null);
  const [reviewState, setReviewState] = useState<{ context: string; page: number; reviews: ProductReview[]; total: number; totalPages: number; loading: boolean; error: boolean } | null>(null);
  const reviewRequest = useRef<{ context: string; selection: string } | null>(null);
  const [relatedState, setRelatedState] = useState<{ context: string; revision: number; products: Product[]; error: boolean } | null>(null);
  const [relatedRetry, setRelatedRetry] = useState(0);
  const relatedRequest = useRef<{ context: string } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [favoriteState, setFavoriteState] = useState<{ context: string; revision: number; selected: boolean; error: boolean } | null>(null);
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const [favoriting, setFavoriting] = useState(false);

  const [selectedSkuId, setSelectedSkuId] = useState<number | undefined>(undefined);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ context: string; message: string } | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const productRequest = useRef<{ context: string } | null>(null);
  const mounted = useRef(true);
  const addingRequest = useRef<string | null>(null);
  const favoriteRequest = useRef<{ context: string } | null>(null);
  const favoriteReadRequest = useRef<{ context: string } | null>(null);
  const productId = parseInt(params.id as string);
  const context = JSON.stringify([productId, sessionId, user?.user_id, isAuthenticated]);
  const visibleFavorite = favoriteState?.context === context && favoriteState.revision === favoriteRetry ? { ...favoriteState, loading: false }
    : { selected: false, loading: isAuthenticated, error: false };
  const isFavorited = visibleFavorite.selected;
  const visibleRelated = relatedState?.context === context && relatedState.revision === relatedRetry ? { ...relatedState, loading: false }
    : { products: [], loading: true, error: false };
  const reviewPage = reviewView?.context === context ? reviewView.page : 1;
  const reviewRevision = reviewView?.context === context ? reviewView.revision : 0;
  const reviewSelection = JSON.stringify([context, reviewPage, reviewRevision]);
  const currentReviewSelection = useRef(reviewSelection);
  currentReviewSelection.current = reviewSelection;
  const visibleReviews = reviewState?.context === context && reviewState.page === reviewPage
    ? reviewState : { reviews: [], total: 0, totalPages: 0, loading: true, error: false };
  const currentContext = useRef(context);
  currentContext.current = context;
  const isCurrentContext = useCallback(() => {
    const auth = useAuthStore.getState();
    return mounted.current && currentContext.current === context &&
      auth.isAuthenticated === isAuthenticated && auth.sessionId === sessionId && auth.user?.user_id === user?.user_id &&
      storedSessionId() === (sessionId ?? null);
  }, [context, isAuthenticated, sessionId, user?.user_id]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isHydrated || !productId) return;
    let active = true;
    const isCurrentRequest = () => active && isCurrentContext();
    setAdding(false);
    addingRequest.current = null;
    setFavoriting(false);
    favoriteRequest.current = null;
    if (isAuthenticated) {
      browseApi.record(productId).catch((error) => { if (isCurrentRequest()) logger.error('记录浏览历史失败:', error); });
    }
    return () => { active = false; };
  }, [isHydrated, productId, isAuthenticated, sessionId, user?.user_id, router, isCurrentContext]);

  useEffect(() => {
    if (!isHydrated || !productId) return;
    let active = true;
    const operation = { context };
    relatedRequest.current = operation;
    const isCurrentRequest = () => active && isCurrentContext() && relatedRequest.current === operation;
    recommendationApi.getRelated(productId, 4).then(data => {
      if (isCurrentRequest()) setRelatedState({ context, revision: relatedRetry, products: data.related_products || [], error: false });
    }).catch(error => {
      if (!isCurrentRequest()) return;
      logger.error('加载相关推荐失败:', error);
      setRelatedState({ context, revision: relatedRetry, products: [], error: true });
    }).finally(() => {
      if (relatedRequest.current === operation) relatedRequest.current = null;
    });
    return () => { active = false; };
  }, [context, isHydrated, productId, isCurrentContext, relatedRetry]);

  const retryRelated = () => {
    if (!isCurrentContext() || !visibleRelated.error || relatedRequest.current?.context === context) return;
    relatedRequest.current = { context };
    setRelatedRetry(previous => previous + 1);
  };

  useEffect(() => {
    if (!isHydrated || !productId || !isAuthenticated) return;
    let active = true;
    const operation = { context };
    favoriteReadRequest.current = operation;
    const isCurrentRequest = () => active && isCurrentContext() && favoriteReadRequest.current === operation;
    favoriteApi.check(productId).then(data => {
      if (isCurrentRequest()) setFavoriteState({ context, revision: favoriteRetry, selected: data.is_favorited, error: false });
    }).catch(error => {
      if (!isCurrentRequest()) return;
      logger.error('检查收藏状态失败:', error);
      setFavoriteState({ context, revision: favoriteRetry, selected: false, error: true });
    }).finally(() => {
      if (favoriteReadRequest.current === operation) favoriteReadRequest.current = null;
    });
    return () => { active = false; };
  }, [context, isHydrated, productId, isAuthenticated, isCurrentContext, favoriteRetry]);

  const retryFavorite = () => {
    if (!isCurrentContext() || !visibleFavorite.error || favoriteReadRequest.current?.context === context) return;
    favoriteReadRequest.current = { context };
    setFavoriteRetry(previous => previous + 1);
  };

  useEffect(() => {
    if (!isHydrated || !productId) return;
    let active = true;
    const request = { context, selection: reviewSelection };
    reviewRequest.current = request;
    const isCurrentRequest = () => active && isCurrentContext() &&
      currentReviewSelection.current === reviewSelection && reviewRequest.current === request;
    setReviewState(previous => ({ context, page: reviewPage, reviews: [],
      total: previous?.context === context ? previous.total : 0,
      totalPages: previous?.context === context ? previous.totalPages : 0, loading: true, error: false }));
    reviewApi.listByProduct(productId, { page: reviewPage, limit: 5 }).then(data => {
      if (!isCurrentRequest()) return;
      const totalPages = Math.ceil(data.total / 5);
      if (reviewPage > Math.max(1, totalPages)) {
        setReviewView({ context, page: Math.max(1, totalPages), revision: reviewRevision });
        return;
      }
      setReviewState({ context, page: reviewPage, reviews: data.reviews || [], total: data.total,
        totalPages, loading: false, error: false });
    }).catch(error => {
      if (!isCurrentRequest()) return;
      logger.error('加载评论失败:', error);
      setReviewState(previous => previous?.context === context && previous.page === reviewPage
        ? { ...previous, loading: false, error: true } : previous);
    }).finally(() => { if (reviewRequest.current === request) reviewRequest.current = null; });
    return () => {
      active = false;
      if (reviewRequest.current === request) reviewRequest.current = null;
    };
  }, [isHydrated, productId, context, reviewPage, reviewRevision, reviewSelection, isCurrentContext]);

  const changeReviewPage = (page: number, retry = false) => {
    if (!isCurrentContext() || currentReviewSelection.current !== reviewSelection || reviewRequest.current?.context === context || visibleReviews.loading) return;
    if (!retry && (page < 1 || page > visibleReviews.totalPages || page === reviewPage)) return;
    reviewRequest.current = { context, selection: reviewSelection };
    setReviewView({ context, page, revision: reviewRevision + (retry ? 1 : 0) });
  };

  // Retrying inventory must not repeat browse recording or the other context side effects above.
  useEffect(() => {
    if (!isHydrated || !productId) return;
    let active = true;
    const request = { context };
    productRequest.current = request;
    const isCurrentRequest = () => active && isCurrentContext() && productRequest.current === request;
    setLoading(true);
    setLoadedProduct(null);
    setLoadedContext(null);
    setLoadFailure(null);
    setQuantity(1);
    setSelectedSkuId(undefined);
    productApi.getDetail(productId).then(data => {
      if (!isCurrentRequest()) return;
      setLoadedProduct(data.product);
      setLoadedContext(context);
    }).catch(error => {
      if (!isCurrentRequest()) return;
      logger.error('加载商品失败:', error);
      const status = requestFailure(error).response?.status;
      if (status === 404 || status === 400) {
        toast.error(translate('商品不存在'));
        router.push('/products');
      } else {
        setLoadFailure({ context, message: '加载商品失败，请重试' });
        toast.error(translate('加载商品失败'));
      }
    }).finally(() => {
      if (isCurrentRequest()) setLoading(false);
      if (productRequest.current === request) productRequest.current = null;
    });
    return () => {
      active = false;
      if (productRequest.current === request) productRequest.current = null;
    };
  }, [isHydrated, productId, isAuthenticated, sessionId, user?.user_id, router, retryRevision, context, isCurrentContext]);

  // Until the client has loaded the product for this context, show the server's copy with every control locked.
  const ready = isHydrated && !loading && loadedContext === context;
  const product = ready ? loadedProduct : initialProduct?.product_id === productId ? initialProduct : null;
  const title = localizedText(product?.title, product?.title_en, locale);
  const locked = adding || !ready;
  const hasSku = !!product?.has_sku;
  const skus = product?.skus || [];
  const selectedSku = skus.find(sku => sku.sku_id === selectedSkuId);
  const stock = Number(hasSku ? selectedSku?.stock ?? 0 : product?.stock ?? 0);
  const price = selectedSku?.price ?? product?.price;
  const originalPrice = hasSku ? selectedSku?.original_price : product?.original_price;
  const image = selectedSku?.image || product?.main_image;
  const canPurchase = !hasSku || !!selectedSku;
  const soldOut = hasSku ? (selectedSku ? stock <= 0 : !skus.some(sku => Number(sku.stock) > 0)) : stock <= 0;
  const errorNotice = loadFailure?.context === context && (
    <div className="card p-6 mb-6 text-center" role="alert">
      <p className="text-red-600">{t(loadFailure.message)}</p>
      <button className="btn btn-secondary mt-4" disabled={loading} onClick={() => {
        if (!isCurrentContext() || productRequest.current?.context === context) return;
        productRequest.current = { context };
        setRetryRevision(value => value + 1);
      }}>{t('重新加载')}</button>
    </div>
  );

  const handleAddToCart = async (): Promise<boolean> => {
    if (!product || !ready || !isCurrentContext() || addingRequest.current) return false;
    if (!isAuthenticated) {
      toast.error(translate("请先登录"));
      router.push('/login');
      return false;
    }
    if (!canPurchase) {
      toast.error(translate("请选择商品规格"));
      return false;
    }
    if (quantity < 1 || quantity > stock) {
      toast.error(translate("商品库存不足"));
      return false;
    }
    addingRequest.current = context;
    setAdding(true);
    try {
      if (!await addToCart({ product_id: productId, quantity, ...(selectedSku && { sku_id: selectedSku.sku_id }) }, isCurrentContext)) return false;
      toast.success(translate("已加入购物车"));
      return true;
    } catch (error) {
      if (isCurrentContext()) toast.error(translate(requestFailure(error).response?.data?.error || "加入购物车失败"));
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
    if (!ready || !isCurrentContext() || favoriteRequest.current?.context === context) return;
    if (!isAuthenticated) {
      toast.error(translate("请先登录"));
      router.push('/login');
      return;
    }
    if (visibleFavorite.loading || visibleFavorite.error || favoriteReadRequest.current?.context === context) return;
    const operation = { context };
    favoriteRequest.current = operation;
    setFavoriting(true);
    const selected = !isFavorited;
    try {
      const data = await (selected ? favoriteApi.add(productId) : favoriteApi.remove(productId));
      if (!isCurrentContext()) return;
      setFavoriteState({ context, revision: favoriteRetry, selected, error: false });
      toast.success(translate(data.message));
    } catch (error) {
      if (!isCurrentContext()) return;
      const failure = requestFailure(error), status = failure.response?.status;
      if (!selected && status === 404 && failure.response?.data?.message === '收藏记录不存在') {
        setFavoriteState({ context, revision: favoriteRetry, selected: false, error: false });
        toast.success(translate('取消收藏成功'));
      } else if (status === undefined || status >= 500 || status === 408) {
        // The write may have committed. Reconcile through GET before permitting another intent.
        favoriteReadRequest.current = { context };
        setFavoriteRetry(previous => previous + 1);
        toast.error(translate('操作结果尚未确认，正在重新加载收藏状态'));
      } else toast.error(translate(failure.response?.data?.message || '操作失败'));
    } finally {
      if (isCurrentContext() && favoriteRequest.current === operation) {
        favoriteRequest.current = null;
        setFavoriting(false);
      }
    }
  };

  if (!product) {
    if (errorNotice) return <div className="py-10"><div className="container-custom">{errorNotice}</div></div>;
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
        {errorNotice}
        <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
          {/* 商品图片 */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <ProductImage src={image} alt={title} className="aspect-square" fit="contain" priority />
          </div>

          {/* 商品信息 */}
          <div className="space-y-6">
            <div>
              <h1 data-product-title-id={product.product_id} data-product-title={product.title}
                data-product-title-en={product.title_en || undefined}
                className="mb-3 text-2xl font-semibold tracking-tight text-gray-900 md:text-3xl">
                {title}
              </h1>
              
              <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                <div className="flex items-center">
                  {product.review_count !== 0 && Number(product.rating) > 0 && <FaStar className="mr-1 h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
                  <span>{product.review_count === 0 || Number(product.rating) <= 0 ? t('暂无评价') : t('{rating} 分', { rating: Number(product.rating) })}</span>
                  {!!product.review_count && <span className="ml-2">{t('共 {count} 条评价', { count: product.review_count })}</span>}
                </div>
                <div>{t('已售 {count} 件', { count: product.sales_count })}</div>
                <div>{t('库存 {count} 件', { count: hasSku && !selectedSku ? product.stock : stock })}</div>
              </div>

              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-semibold text-primary-600">
                    ¥{price}
                  </span>
                  {Number(originalPrice) > Number(price) && (
                    <span className="text-base text-gray-500 line-through">
                      ¥{originalPrice}
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
                      {specSummary(sku.specs, sku.specs_en, locale) || sku.sku_code}
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
                disabled={favoriting || !ready || (isAuthenticated && (visibleFavorite.loading || visibleFavorite.error))}
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

            {isAuthenticated && visibleFavorite.loading && <p role="status" className="text-sm text-gray-500">{t('正在加载收藏状态...')}</p>}
            {isAuthenticated && visibleFavorite.error && <div role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">
              <p>{t('加载收藏状态失败，请重试')}</p>
              <button onClick={retryFavorite} className="mt-2 btn btn-outline">{t('重新加载收藏状态')}</button>
            </div>}

            {/* 商品描述 */}
            <div className="border-t border-gray-200 pt-6">
              <h2 className="mb-3 text-base font-semibold text-gray-900">{t("商品详情")}</h2>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">
                {localizedText(product.description, product.description_en, locale) || t("暂无描述")}
              </p>
            </div>
            {product.specs && Object.keys(product.specs).length > 0 && (
              <section className="border-t border-gray-200 pt-6">
                <h2 className="mb-3 text-base font-semibold text-gray-900">{t('商品参数')}</h2>
                <dl className="space-y-2 text-sm">
                  {localizedSpecs(product.specs, product.specs_en, locale).map(([name, value], index) => (
                    <div key={index} className="grid grid-cols-2 gap-4">
                      <dt className="text-gray-500">{name}</dt><dd className="text-gray-900">{specValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        </div>

        <ProductReviewList reviews={visibleReviews.reviews} loading={visibleReviews.loading} error={visibleReviews.error}
          page={reviewPage} total={visibleReviews.total} totalPages={visibleReviews.totalPages}
          onRetry={() => changeReviewPage(reviewPage, true)} onPageChange={changeReviewPage} />

        <RelatedProducts products={visibleRelated.products} loading={visibleRelated.loading}
          error={visibleRelated.error} onRetry={retryRelated} />
      </div>
    </div>
  );
}
