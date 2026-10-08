'use client';

import { translate, useI18n } from '@/lib/i18n';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { productApi, recommendationApi, type Product } from '@/lib/api';
import { storedSessionId, useAuthStore } from '@/store/useAuthStore';
import ProductCard, { ProductCardSkeleton } from '@/components/ProductCard';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { FiArrowRight, FiGift, FiRotateCcw, FiShoppingBag, FiTruck } from 'react-icons/fi';

const loadHotProducts = async () => (await productApi.getHotProducts(8)).products || [];
const loadNewProducts = async () => (await productApi.list({ sort: 'created_at DESC', limit: 8 })).products || [];
const loadRecommendations = async () => (await recommendationApi.getGuessYouLike(8)).recommendations || [];
const publicCatalog = () => true;

type SectionResult = { scope: string; products: Product[]; loading: boolean; error?: string };

/** Each section owns its request, so retrying one cannot hide a successful neighbor. */
function useProductSection(scope: string, load: () => Promise<Product[]>, isCurrent: () => boolean, errorMessage: string, notify = false) {
  const [result, setResult] = useState<SectionResult | null>(null);
  const mounted = useRef(true);
  const pending = useRef<{ scope: string } | null>(null);
  const retry = useCallback(async () => {
    if (!mounted.current || !isCurrent() || pending.current?.scope === scope) return;
    const operation = { scope }; pending.current = operation;
    setResult({ scope, products: [], loading: true });
    const active = () => mounted.current && isCurrent() && pending.current === operation;
    try {
      const products = await load();
      if (active()) setResult({ scope, products, loading: false });
    } catch (error) {
      if (!active()) return;
      logger.error(errorMessage, error);
      setResult({ scope, products: [], loading: false, error: errorMessage });
      if (notify) toast.error(translate('加载数据失败'));
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        // Storage may change before the auth store re-renders. Discard this scope's loading state too.
        if (mounted.current && !isCurrent()) setResult(null);
      }
    }
  }, [scope, load, isCurrent, errorMessage, notify]);

  useEffect(() => {
    mounted.current = true;
    void retry();
    return () => { mounted.current = false; pending.current = null; };
  }, [retry]);
  const shown = result?.scope === scope && isCurrent() ? result : { scope, products: [], loading: true };
  return { ...shown, retry };
}

export default function Home() {
  const { t } = useI18n();
  const { isAuthenticated, sessionId, user } = useAuthStore();
  const userId = user?.user_id;
  const scope = JSON.stringify([sessionId, userId, isAuthenticated]);
  const isCurrentSession = useCallback(() => {
    const auth = useAuthStore.getState();
    try {
      return auth.isAuthenticated === isAuthenticated &&
        auth.sessionId === sessionId && auth.user?.user_id === userId && storedSessionId() === (sessionId ?? null);
    } catch { return false; }
  }, [isAuthenticated, sessionId, userId]);
  const hot = useProductSection('hot', loadHotProducts, publicCatalog, '加载热门商品失败，请重试', true);
  const latest = useProductSection('new', loadNewProducts, publicCatalog, '加载新品失败，请重试', true);
  const recommendations = useProductSection(scope, loadRecommendations, isCurrentSession, '加载推荐失败，请重试');

  return (
    <div>
      {/* 优惠券公告栏 */}
      <section className="bg-gray-900 text-white">
        <div className="container-custom">
          <Link
            href={isAuthenticated ? "/coupons" : "/login"}
            className="group flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2.5 text-sm"
          >
            <FiGift className="h-4 w-4 text-primary-400" aria-hidden="true" />
            <span className="font-medium">{t("领取优惠券，享更多优惠")}</span>
            <span className="hidden text-gray-400 sm:inline">
              {isAuthenticated ? t("新用户专享优惠券等你来领") : t("登录即可领取专属优惠券")}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-white underline-offset-4 group-hover:underline">
              {isAuthenticated ? t("立即领取") : t("立即登录")}
              <FiArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </Link>
        </div>
      </section>

      {/* 首屏 */}
      <section className="relative overflow-hidden border-b border-gray-200 bg-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-primary-100/70 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 left-1/3 h-80 w-80 rounded-full bg-primary-50 blur-3xl" />
        <div className="container-custom relative py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900 md:text-5xl">{t("欢迎来到电商平台")}</h1>
            <p className="mt-4 text-lg text-gray-600">{t("发现优质商品，享受便捷购物")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/products" className="btn btn-primary inline-flex items-center gap-2 rounded-full px-6">
                {t("立即购物")}
                <FiArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href={isAuthenticated ? "/coupons" : "/login"} className="btn btn-secondary rounded-full px-6">
                {t("优惠券中心")}</Link>
            </div>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-3">
            {SERVICE_HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{t(title)}</p>
                  <p className="mt-0.5 text-sm text-gray-500">{t(description)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ProductSection title={t("热门商品")} href="/products?sort=sales_count DESC" products={hot.products} loading={hot.loading} error={hot.error} onRetry={hot.retry} />
      <ProductSection title={t("新品推荐")} href="/products?sort=created_at DESC" products={latest.products} loading={latest.loading} error={latest.error} onRetry={latest.retry} />
      {isCurrentSession() && (recommendations.loading || recommendations.error || recommendations.products.length > 0) && (
        <ProductSection
          title={t("猜你喜欢")}
          subtitle={isAuthenticated ? t("基于您的浏览历史为您推荐") : t("热门商品推荐")}
          href="/products"
          products={recommendations.products}
          loading={recommendations.loading}
          error={recommendations.error}
          onRetry={recommendations.retry}
        />
      )}
    </div>
  );
}

const SERVICE_HIGHLIGHTS = [
  { icon: FiTruck, title: '物流信息', description: '订单发货后查看快递公司和运单号' },
  { icon: FiShoppingBag, title: '商品详情', description: '查看商品信息、价格与库存' },
  { icon: FiRotateCcw, title: '售后申请', description: '在订单详情中提交并查看审核进度' },
] as const;

interface ProductSectionProps {
  title: string;
  subtitle?: string;
  href: string;
  products: ComponentProps<typeof ProductCard>['product'][];
  loading: boolean;
  error?: string;
  onRetry: () => void;
}

function ProductSection({ title, subtitle, href, products, loading, error, onRetry }: ProductSectionProps) {
  const { t } = useI18n();
  return (
    <section className="py-12 md:py-16">
      <div className="container-custom">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          </div>
          <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary-600">
            {t("查看更多")}
            <FiArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>

        {error ? <div role="alert" className="rounded-lg border border-red-100 p-6 text-center">
          <p className="text-red-600">{t(error)}</p>
          <button onClick={onRetry} className="btn btn-secondary mt-4">{t('重新加载')}</button>
        </div> : !loading && products.length === 0 ? <p className="py-8 text-center text-gray-500">{t('暂无商品')}</p> : (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4" aria-busy={loading}>
            {loading
              ? [...Array(8)].map((_, i) => <ProductCardSkeleton key={i} />)
              : products.map((product) => <ProductCard key={product.product_id} product={product} />)}
          </div>
        )}
      </div>
    </section>
  );
}
