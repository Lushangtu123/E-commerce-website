'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { userApi, type UserStats } from '@/lib/api';
import Link from 'next/link';
import Image from 'next/image';
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
  FiPhone,
  FiMail,
  FiTrendingUp,
  FiAward,
  FiPackage
} from 'react-icons/fi';
import { logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, token, isAuthenticated, isHydrated, logout } = useAuthStore();
  const [result, setResult] = useState<{ key: string; stats?: UserStats; error?: string } | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatarKey = JSON.stringify([user?.user_id, user?.avatar_url]);
  const avatar = user?.avatar_url && /^https?:\/\/\S+$/i.test(user.avatar_url) && failedAvatar !== avatarKey ? user.avatar_url : null;
  const mounted = useRef(true);
  const revision = useRef(0);
  const sessionKey = JSON.stringify([token, user?.user_id]);
  const stats = result?.key === sessionKey ? result.stats : undefined;
  const error = result?.key === sessionKey ? result.error : undefined;
  const loading = result?.key !== sessionKey;
  const isCurrent = () => {
    const current = useAuthStore.getState();
    return mounted.current && current.isAuthenticated && current.token === token && current.user?.user_id === user?.user_id &&
      localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadUserStats();
    return () => { revision.current += 1; };
  }, [isHydrated, isAuthenticated, token, user?.user_id, router]);

  const loadUserStats = async () => {
    if (!isCurrent()) return;
    const request = ++revision.current;
    setResult(null);
    try {
      const data = await userApi.getStats();
      if (!isCurrent() || revision.current !== request) return;
      setResult({ key: sessionKey, stats: data.stats });
    } catch (error) {
      if (!isCurrent() || revision.current !== request) return;
      logger.error('加载统计数据失败:', error);
      setResult({ key: sessionKey, error: '统计数据加载失败，请重试' });
    }
  };

  const handleLogout = () => {
    if (!isCurrent()) return;
    logout();
    router.push('/');
  };

  const menuItems = [
    {
      icon: <FiShoppingBag size={24} />,
      title: '我的订单',
      description: '查看订单状态',
      link: '/orders',
      count: stats?.totalOrders,
    },
    {
      icon: <FiGift size={24} />,
      title: '我的优惠券',
      description: stats ? t('{count}张可用', { count: stats.availableCoupons }) : '查看我的优惠券',
      link: '/my/coupons',
      count: stats?.totalCoupons,
      highlight: true,
    },
    {
      icon: <FiHeart size={24} />,
      title: '我的收藏',
      description: '收藏的商品',
      link: '/favorites',
      count: stats?.favoriteCount,
    },
    {
      icon: <FiClock size={24} />,
      title: '浏览足迹',
      description: '最近浏览',
      link: '/history',
    },
    {
      icon: <FiCreditCard size={24} />,
      title: '优惠券中心',
      description: '领取更多优惠券',
      link: '/coupons',
      highlight: true,
    },
    {
      icon: <FiMapPin size={24} />,
      title: '收货地址',
      description: '管理地址',
      link: '/profile/address',
    },
  ];

  if (!isHydrated || !isAuthenticated || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-gray-600">{t("加载中...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 用户信息卡片 */}
        <div className="bg-white rounded-2xl ring-1 ring-gray-200 shadow-xs p-6 sm:p-8 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4 sm:gap-6">
              <div className="w-20 h-20 shrink-0 bg-primary-50 rounded-full flex items-center justify-center overflow-hidden">
                {avatar ? <Image src={avatar} width={80} height={80} unoptimized alt={t('用户头像')} className="w-full h-full object-cover" onError={() => setFailedAvatar(avatarKey)} /> : <FiUser size={40} className="text-primary-600" />}
              </div>
              <div className="min-w-0">
                <h1 className="mb-2 truncate text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{user?.username || t('用户')}</h1>
                <p className="truncate text-gray-600">{user?.email || ''}</p>
                <p className="text-sm text-gray-500 mt-1">{t("用户ID:")} {user?.user_id || 'N/A'}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="btn btn-secondary flex items-center gap-2 px-6 py-3"
            >
              <FiLogOut size={20} />
              <span>{t("退出登录")}</span>
            </button>
          </div>

          {/* 快速统计 */}
          <div className="grid grid-cols-4 gap-4 mt-8 pt-8 border-t border-gray-100">
            <div className="text-center">
              <div className="text-3xl font-semibold text-gray-900 mb-1">{stats?.totalOrders ?? '—'}</div>
              <div className="text-sm text-gray-500">{t("我的订单")}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-semibold text-gray-900 mb-1">{stats?.availableCoupons ?? '—'}</div>
              <div className="text-sm text-gray-500">{t("可用优惠券")}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-semibold text-gray-900 mb-1">{stats?.favoriteCount ?? '—'}</div>
              <div className="text-sm text-gray-500">{t("我的收藏")}</div>
            </div>
            <Link href="/orders?status=0" className="text-center rounded-lg hover:bg-gray-50">
              <div className="text-3xl font-semibold text-gray-900 mb-1">{stats?.pendingOrders ?? '—'}</div>
              <div className="text-sm text-gray-500">{t("待支付")}</div>
            </Link>
          </div>
        </div>

        {error && <div role="alert" className="bg-white rounded-xl p-4 mb-6 text-red-600">
          <p>{t(error)}</p>
          <button onClick={loadUserStats} className="underline mt-2">{t("重新加载统计")}</button>
        </div>}

        {/* 优惠券快捷入口 - 突出显示 */}
        <div className="bg-gray-900 rounded-xl p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-white">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                <FiGift size={32} className="text-primary-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-1">{t("优惠券中心")}</h2>
                <p className="text-gray-300">
                  {stats ? <>{t('您有')} <span className="font-bold text-xl">{stats.availableCoupons}</span> {t('张可用优惠券')}</> : t('查看或领取优惠券')}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/coupons"
                className="px-6 py-3 bg-white text-gray-900 rounded-lg hover:bg-gray-100 transition-colors font-medium"
              >
                {t("领取优惠券")}
              </Link>
              <Link
                href="/my/coupons"
                className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors font-medium"
              >
                {t("我的优惠券")}
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
              className={`bg-white rounded-xl ring-1 shadow-xs hover:shadow-md transition-shadow duration-300 p-6 ${
                item.highlight ? 'ring-primary-200' : 'ring-gray-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-primary-50 text-primary-600 rounded-xl flex items-center justify-center">
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {t(item.title)}
                      {item.highlight && <FiTrendingUp className="ml-2 inline h-4 w-4 align-[-2px] text-primary-500" aria-hidden="true" />}
                    </h3>
                    <p className="text-sm text-gray-500">{t(item.description)}</p>
                  </div>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <div className="bg-primary-600 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[24px] text-center">
                    {item.count}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* 账户信息 */}
        <div className="mt-8 bg-white rounded-xl ring-1 ring-gray-200 shadow-xs p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FiSettings size={24} />
              {t("账户信息")}
            </h2>
            <Link href="/profile/settings" className="btn btn-outline">{t('编辑资料')}</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center">
                <FiUser size={24} className="text-primary-600" />
              </div>
              <div>
                <div className="text-sm text-gray-500">{t("用户名")}</div>
                <div className="font-medium text-gray-900">{user?.username || 'N/A'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center">
                <FiMail size={24} className="text-primary-600" />
              </div>
              <div>
                <div className="text-sm text-gray-500">{t("邮箱")}</div>
                <div className="font-medium text-gray-900">{user?.email || 'N/A'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center"><FiPhone size={24} className="text-primary-600" /></div>
              <div><div className="text-sm text-gray-500">{t('联系电话')}</div><div className="font-medium text-gray-900">{user?.phone || t('未填写')}</div></div>
            </div>
          </div>
        </div>

        {/* 快速操作 */}
        <div className="mt-8 bg-white rounded-xl ring-1 ring-gray-200 shadow-xs p-6">
          <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900"><FiAward className="h-5 w-5 text-primary-600" aria-hidden="true" />{t("会员专享")}</h3>
          <div className="grid grid-cols-3 gap-4">
            <Link
              href="/coupons"
              className="bg-gray-50 text-gray-700 hover:bg-primary-50 hover:text-primary-700 rounded-lg p-4 text-center transition-colors"
            >
              <FiGift className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              <div className="font-medium">{t("领取优惠券")}</div>
            </Link>
            <Link
              href="/products"
              className="bg-gray-50 text-gray-700 hover:bg-primary-50 hover:text-primary-700 rounded-lg p-4 text-center transition-colors"
            >
              <FiShoppingBag className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              <div className="font-medium">{t("继续购物")}</div>
            </Link>
            <Link
              href="/orders"
              className="bg-gray-50 text-gray-700 hover:bg-primary-50 hover:text-primary-700 rounded-lg p-4 text-center transition-colors"
            >
              <FiPackage className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              <div className="font-medium">{t("查看订单")}</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
