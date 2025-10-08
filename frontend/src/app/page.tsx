'use client';

import { useEffect, useState } from 'react';
import { productApi } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function Home() {
  const [hotProducts, setHotProducts] = useState<any[]>([]);
  const [newProducts, setNewProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

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
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
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

