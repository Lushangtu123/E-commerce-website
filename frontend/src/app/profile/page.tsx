'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { userApi, couponApi } from '@/lib/api';
import Link from 'next/link';
import {
  FiUser, 
  FiShoppingBag, 
  FiHeart, 
  FiClock, 
  FiSettings, 
  FiLogOut,
  FiGift,
  FiCreditCard,
  FiMapPin,
  FiPhone
} from 'react-icons/fi';
import { logger } from '@/lib/logger';

interface UserStats {
  totalOrders: number;
  pendingOrders: number;
  totalCoupons: number;
  availableCoupons: number;
  favoriteCount: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [stats, setStats] = useState<UserStats>({
    totalOrders: 0,
    pendingOrders: 0,
    totalCoupons: 0,
    availableCoupons: 0,
    favoriteCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadUserStats();
  }, [isAuthenticated, router]);

  const loadUserStats = async () => {
    try {
      setLoading(true);
      
      // 加载优惠券统计
      const couponData = await couponApi.getMyCoupons();
      const allCoupons = couponData.data || [];
      const availableCoupons = allCoupons.filter((c: any) => c.status === 1);
      
      setStats({
        totalOrders: 0, // 可以从订单API获取
        pendingOrders: 0,
        totalCoupons: allCoupons.length,
        availableCoupons: availableCoupons.length,
        favoriteCount: 0, // 可以从收藏API获取
      });
    } catch (error) {
      logger.error('加载统计数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const menuItems = [
    {
      icon: <FiShoppingBag size={24} />,
      title: '我的订单',
      description: '查看订单状态',
      link: '/orders',
      count: stats.totalOrders,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      icon: <FiGift size={24} />,
      title: '我的优惠券',
      description: `${stats.availableCoupons}张可用`,
      link: '/my/coupons',
      count: stats.totalCoupons,
      color: 'text-orange-600 bg-orange-50',
      highlight: true,
    },
    {
      icon: <FiHeart size={24} />,
      title: '我的收藏',
      description: '收藏的商品',
      link: '/favorites',
      count: stats.favoriteCount,
      color: 'text-red-600 bg-red-50',
    },
    {
      icon: <FiClock size={24} />,
      title: '浏览足迹',
      description: '最近浏览',
      link: '/history',
      color: 'text-purple-600 bg-purple-50',
    },
    {
      icon: <FiCreditCard size={24} />,
      title: '优惠券中心',
      description: '领取更多优惠券',
      link: '/coupons',
      color: 'text-green-600 bg-green-50',
      highlight: true,
    },
    {
      icon: <FiMapPin size={24} />,
      title: '收货地址',
      description: '管理地址',
      link: '/profile/address',
      color: 'text-indigo-600 bg-indigo-50',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 用户信息卡片 */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl shadow-xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
                <FiUser size={40} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-3xl font-bold mb-2">{user?.username || '用户'}</h1>
                <p className="text-blue-100">{user?.email || ''}</p>
                <p className="text-sm text-blue-200 mt-1">用户ID: {user?.user_id || 'N/A'}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-6 py-3 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
            >
              <FiLogOut size={20} />
              <span>退出登录</span>
            </button>
          </div>

          {/* 快速统计 */}
          <div className="grid grid-cols-4 gap-4 mt-8 pt-8 border-t border-white border-opacity-20">
            <div className="text-center">
              <div className="text-3xl font-bold mb-1">{stats.totalOrders}</div>
              <div className="text-sm text-blue-100">我的订单</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold mb-1">{stats.availableCoupons}</div>
              <div className="text-sm text-blue-100">可用优惠券</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold mb-1">{stats.favoriteCount}</div>
              <div className="text-sm text-blue-100">我的收藏</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold mb-1">0</div>
              <div className="text-sm text-blue-100">待处理</div>
            </div>
          </div>
        </div>

        {/* 优惠券快捷入口 - 突出显示 */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <FiGift size={32} />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-1">🎁 优惠券中心</h2>
                <p className="text-orange-100">
                  您有 <span className="font-bold text-xl">{stats.availableCoupons}</span> 张可用优惠券
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/coupons"
                className="px-6 py-3 bg-white text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-medium"
              >
                领取优惠券
              </Link>
              <Link
                href="/my/coupons"
                className="px-6 py-3 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors font-medium"
              >
                我的优惠券
              </Link>
            </div>
          </div>
        </div>

        {/* 功能菜单网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {menuItems.map((item, index) => (
            <Link
              key={index}
              href={item.link}
              className={`bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 p-6 ${
                item.highlight ? 'ring-2 ring-orange-500 ring-opacity-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 ${item.color} rounded-xl flex items-center justify-center`}>
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {item.title}
                      {item.highlight && <span className="ml-2 text-orange-500">🔥</span>}
                    </h3>
                    <p className="text-sm text-gray-500">{item.description}</p>
                  </div>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <div className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[24px] text-center">
                    {item.count}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* 账户信息 */}
        <div className="mt-8 bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <FiSettings size={24} />
            账户信息
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
                <FiUser size={24} className="text-blue-600" />
              </div>
              <div>
                <div className="text-sm text-gray-500">用户名</div>
                <div className="font-medium text-gray-900">{user?.username || 'N/A'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                <FiPhone size={24} className="text-green-600" />
              </div>
              <div>
                <div className="text-sm text-gray-500">邮箱</div>
                <div className="font-medium text-gray-900">{user?.email || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 快速操作 */}
        <div className="mt-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl shadow-lg p-6 text-white">
          <h3 className="text-xl font-bold mb-4">💎 会员专享</h3>
          <div className="grid grid-cols-3 gap-4">
            <Link
              href="/coupons"
              className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg p-4 text-center transition-colors"
            >
              <div className="text-2xl mb-2">🎁</div>
              <div className="font-medium">领取优惠券</div>
            </Link>
            <Link
              href="/products"
              className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg p-4 text-center transition-colors"
            >
              <div className="text-2xl mb-2">🛍️</div>
              <div className="font-medium">继续购物</div>
            </Link>
            <Link
              href="/orders"
              className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg p-4 text-center transition-colors"
            >
              <div className="text-2xl mb-2">📦</div>
              <div className="font-medium">查看订单</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

