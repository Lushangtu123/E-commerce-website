'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cartApi } from '@/lib/api';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { FiShoppingCart } from 'react-icons/fi';

interface ProductCardProps {
  product: any;
}

export default function ProductCard({ product }: ProductCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const { isAuthenticated } = useAuthStore();
  const { addItem } = useCartStore();

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      toast.error('请先登录');
      return;
    }

    setIsAdding(true);
    try {
      await cartApi.add({ product_id: product.product_id, quantity: 1 });
      addItem({
        cart_id: Date.now(),
        product_id: product.product_id,
        quantity: 1,
        title: product.title,
        price: product.price,
        main_image: product.main_image,
        stock: product.stock,
      });
      toast.success('已加入购物车');
    } catch (error: any) {
      console.error('加入购物车失败:', error);
      toast.error(error.response?.data?.error || '加入购物车失败');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Link href={`/products/${product.product_id}`} className="card group hover:shadow-lg transition-shadow">
      <div className="relative overflow-hidden bg-gray-200 h-64">
        {product.main_image ? (
          <img
            src={product.main_image}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            暂无图片
          </div>
        )}
        {product.original_price && product.original_price > product.price && (
          <div className="absolute top-2 right-2 bg-primary-600 text-white px-2 py-1 rounded text-sm">
            促销
          </div>
        )}
      </div>
      
      <div className="p-4">
        <h3 className="font-medium text-gray-900 mb-2 line-clamp-2 min-h-[3rem]">
          {product.title}
        </h3>
        
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-primary-600 text-xl font-bold">¥{product.price}</span>
            {product.original_price && product.original_price > product.price && (
              <span className="text-gray-400 text-sm line-through ml-2">
                ¥{product.original_price}
              </span>
            )}
          </div>
          <span className="text-gray-500 text-sm">已售 {product.sales_count}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-yellow-400 mr-1">★</span>
            <span className="text-gray-600 text-sm">{product.rating}</span>
          </div>
          
          <button
            onClick={handleAddToCart}
            disabled={isAdding || product.stock === 0}
            className={`flex items-center space-x-1 px-3 py-1 rounded ${
              product.stock === 0
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            <FiShoppingCart />
            <span className="text-sm">
              {product.stock === 0 ? '已售罄' : isAdding ? '加入中...' : '加入'}
            </span>
          </button>
        </div>
      </div>
    </Link>
  );
}

