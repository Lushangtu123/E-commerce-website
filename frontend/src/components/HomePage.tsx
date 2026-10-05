'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { productApi, recommendationApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import ProductCard, { ProductCardSkeleton } from '@/components/ProductCard';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { FiArrowRight, FiGift, FiRotateCcw, FiShield, FiTruck } from 'react-icons/fi';

export default function Home() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuthStore();
  const [hotProducts, setHotProducts] = useState<Product[]>([]);
  const [newProducts, setNewProducts] = useState<Product[]>([]);
  // The subtitle must describe the session the recommendations were fetched for.
  const [recommendations, setRecommendations] = useState<{ products: Product[]; personalized: boolean }>({ products: [], personalized: false });
  const recommendationRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadRecommendations();
  }, [isAuthenticated]);

  // Hot and new products load independently, so one failing request cannot blank both sections.
  const loadData = async () => {
    setLoading(true);
    const [hot, latest] = await Promise.allSettled([
      productApi.getHotProducts(8),
      productApi.list({ sort: 'created_at DESC', limit: 8 }),
    ]);
    if (hot.status === 'fulfilled') setHotProducts(hot.value.products || []);
    if (latest.status === 'fulfilled') setNewProducts(latest.value.products || []);
    const failures = [hot, latest].filter((result) => result.status === 'rejected');
    failures.forEach((failure) => logger.error('加载数据失败:', failure.reason));
    if (failures.length) toast.error(t("加载数据失败"));
    setLoading(false);
  };

  // Login state hydrates after mount, so requests can overlap; only the latest one may update the page.
  const loadRecommendations = async () => {
    const request = ++recommendationRequest.current;
    const personalized = isAuthenticated;
    setLoadingRecommendations(true);
    try {
      const data = await recommendationApi.getGuessYouLike(8);
      if (request === recommendationRequest.current) setRecommendations({ products: data.recommendations || [], personalized });
    } catch (error) {
      if (request !== recommendationRequest.current) return;
      logger.error('加载推荐失败:', error);
      setRecommendations({ products: [], personalized });
    } finally {
      if (request === recommendationRequest.current) setLoadingRecommendations(false);
    }
  };

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

      <ProductSection title={t("热门商品")} href="/products?sort=sales_count DESC" products={hotProducts} loading={loading} />
      <ProductSection title={t("新品推荐")} href="/products?sort=created_at DESC" products={newProducts} loading={loading} />
      {recommendations.products.length > 0 && (
        <ProductSection
          title={t("猜你喜欢")}
          subtitle={recommendations.personalized ? t("基于您的浏览历史为您推荐") : t("热门商品推荐")}
          href="/products"
          products={recommendations.products}
          loading={loadingRecommendations}
        />
      )}
    </div>
  );
}

const SERVICE_HIGHLIGHTS = [
  { icon: FiTruck, title: '快速配送', description: '全国包邮，48小时送达' },
  { icon: FiShield, title: '品质保证', description: '正品保障，假一赔十' },
  { icon: FiRotateCcw, title: '售后无忧', description: '7天无理由退换货' },
] as const;

interface ProductSectionProps {
  title: string;
  subtitle?: string;
  href: string;
  products: ComponentProps<typeof ProductCard>['product'][];
  loading: boolean;
}

function ProductSection({ title, subtitle, href, products, loading }: ProductSectionProps) {
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

        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {loading
            ? [...Array(8)].map((_, i) => <ProductCardSkeleton key={i} />)
            : products.map((product) => <ProductCard key={product.product_id} product={product} />)}
        </div>
      </div>
    </section>
  );
}
