'use client';

import { useEffect, useState } from 'react';
import { productApi, recommendationApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import ProductCard from '@/components/ProductCard';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

export default function Home() {
  const { isAuthenticated } = useAuthStore();
  const [hotProducts, setHotProducts] = useState<any[]>([]);
  const [newProducts, setNewProducts] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadRecommendations();
  }, [isAuthenticated]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // 加载热门商品
      const hotData: any = await productApi.getHotProducts(8);
      setHotProducts(hotData.products || []);

      // 加载新品
      const newData: any = await productApi.list({ sort: 'created_at DESC', limit: 8 });
      setNewProducts(newData.products || []);
    } catch (error: any) {
      logger.error('加载数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendations = async () => {
    try {
      setLoadingRecommendations(true);
      const data: any = await recommendationApi.getGuessYouLike(8);
      setRecommendations(data.recommendations || []);
    } catch (error: any) {
      logger.error('加载推荐失败:', error);
    } finally {
      setLoadingRecommendations(false);
    }
  };

  return (
    <div>
      {/* 优惠券横幅 - 始终显示 */}
      <section className="bg-gradient-to-r from-orange-500 to-red-500 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href={isAuthenticated ? "/coupons" : "/login"} className="flex items-center justify-between hover:opacity-90 transition-opacity">
            <div className="flex items-center gap-3">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
              <div>
                <div className="font-semibold text-lg">🎁 领取优惠券，享更多优惠</div>
                <div className="text-sm opacity-90">{isAuthenticated ? '新用户专享优惠券等你来领' : '登录即可领取专属优惠券'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{isAuthenticated ? '立即领取' : '立即登录'}</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        </div>
      </section>
      
      {/* 轮播图区域 */}
      <section className="bg-gradient-to-r from-primary-600 to-primary-800 text-white py-20">
        <div className="container-custom">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-bold mb-4">欢迎来到电商平台</h1>
            <p className="text-xl mb-8">发现优质商品，享受便捷购物</p>
            <Link href="/products" className="btn btn-primary bg-white text-primary-600 hover:bg-gray-100 inline-block">
              立即购物
            </Link>
          </div>
        </div>
      </section>

      {/* 热门商品 */}
      <section className="py-12">
        <div className="container-custom">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold">热门商品</h2>
            <Link href="/products?sort=sales_count DESC" className="text-primary-600 hover:text-primary-700">
              查看更多 →
            </Link>
          </div>
          
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="bg-gray-300 h-64 w-full"></div>
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-300 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {hotProducts.map((product) => (
                <ProductCard key={product.product_id} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 新品推荐 */}
      <section className="py-12 bg-white">
        <div className="container-custom">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold">新品推荐</h2>
            <Link href="/products?sort=created_at DESC" className="text-primary-600 hover:text-primary-700">
              查看更多 →
            </Link>
          </div>
          
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="bg-gray-300 h-64 w-full"></div>
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-300 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {newProducts.map((product) => (
                <ProductCard key={product.product_id} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 猜你喜欢 */}
      {recommendations.length > 0 && (
        <section className="py-12">
          <div className="container-custom">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-bold">猜你喜欢</h2>
                <p className="text-gray-600 mt-2">
                  {isAuthenticated ? '基于您的浏览历史为您推荐' : '热门商品推荐'}
                </p>
              </div>
              <Link href="/products" className="text-primary-600 hover:text-primary-700">
                查看更多 →
              </Link>
            </div>
            
            {loadingRecommendations ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="card animate-pulse">
                    <div className="bg-gray-300 h-64 w-full"></div>
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                      <div className="h-4 bg-gray-300 rounded w-1/2"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {recommendations.map((product) => (
                  <ProductCard key={product.product_id} product={product} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 优势特点 */}
      <section className="py-12">
        <div className="container-custom">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-primary-600 text-2xl">🚚</span>
              </div>
              <h3 className="font-bold text-xl mb-2">快速配送</h3>
              <p className="text-gray-600">全国包邮，48小时送达</p>
            </div>
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-primary-600 text-2xl">✓</span>
              </div>
              <h3 className="font-bold text-xl mb-2">品质保证</h3>
              <p className="text-gray-600">正品保障，假一赔十</p>
            </div>
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-primary-600 text-2xl">💬</span>
              </div>
              <h3 className="font-bold text-xl mb-2">售后无忧</h3>
              <p className="text-gray-600">7天无理由退换货</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

