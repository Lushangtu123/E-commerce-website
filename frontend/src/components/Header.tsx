'use client';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/lib/i18n';

import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { FiShoppingCart, FiUser, FiSearch, FiLogOut, FiClock, FiX, FiTrendingUp, FiGift } from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchApi } from '@/lib/api';
import { logger } from '@/lib/logger';

export default function Header() {
  const { t } = useI18n();
  const { isAuthenticated, isHydrated, token, user, logout } = useAuthStore();
  const { getTotalCount } = useCartStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [history, setHistory] = useState<{ scope: string | null; rows: any[] }>({ scope: null, rows: [] });
  const [hotKeywords, setHotKeywords] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const historyRequest = useRef(0);
  const scope = isHydrated && isAuthenticated && token && user ? JSON.stringify([token, user.user_id]) : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const isCurrentSession = () => {
    const auth = useAuthStore.getState();
    try {
      return mounted.current && !!scope && currentScope.current === scope && auth.isHydrated && auth.isAuthenticated &&
        auth.token === token && auth.user?.user_id === user?.user_id && localStorage.getItem('token') === token;
    } catch { return false; }
  };
  const searchHistory = isCurrentSession() && history.scope === scope ? history.rows : [];

  useEffect(() => {
    mounted.current = true;
    fetchHotKeywords();
    return () => { mounted.current = false; historyRequest.current += 1; };
  }, []);

  useEffect(() => {
    historyRequest.current += 1;
    setHistory({ scope: null, rows: [] });
    setSearchKeyword('');
    setShowDropdown(false);
    if (scope) fetchSearchHistory();
  }, [scope]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSearchHistory = async () => {
    if (!isCurrentSession()) return;
    const request = ++historyRequest.current;
    try {
      const data: any = await searchApi.getHistory(10);
      if (isCurrentSession() && request === historyRequest.current) {
        setHistory({ scope, rows: data.history || [] });
      }
    } catch (error) {
      if (isCurrentSession() && request === historyRequest.current) logger.error('获取搜索历史失败:', error);
    }
  };

  const fetchHotKeywords = async () => {
    try {
      const data: any = await searchApi.getHot(7, 10);
      if (mounted.current) setHotKeywords(data.keywords || []);
    } catch (error) {
      logger.error('获取热搜失败:', error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchKeyword.trim()) {
      setShowDropdown(false);
      router.push(`/products?keyword=${encodeURIComponent(searchKeyword.trim())}`);
      // 记录搜索历史
      if (isCurrentSession()) {
        try {
          await searchApi.record(searchKeyword.trim());
          if (isCurrentSession()) fetchSearchHistory();
        } catch (error) {
          logger.error('记录搜索历史失败:', error);
        }
      }
    }
  };

  const handleHistoryClick = (keyword: string, privateHistory = false) => {
    if (privateHistory && !isCurrentSession()) return;
    setSearchKeyword(keyword);
    setShowDropdown(false);
    router.push(`/products?keyword=${encodeURIComponent(keyword)}`);
  };

  const handleDeleteHistory = async (keyword: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isCurrentSession()) return;
    try {
      await searchApi.deleteKeyword(keyword);
      if (isCurrentSession()) fetchSearchHistory();
    } catch (error) {
      logger.error('删除搜索记录失败:', error);
    }
  };

  const handleLogout = () => {
    logout();
    // 延迟跳转，确保状态已清除
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
  };

  return (
    <header className="bg-white shadow-xs sticky top-0 z-50">
      <div className="container-custom py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="text-2xl font-bold text-primary-600">
            {t("电商平台")}</Link>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} className="order-last w-full md:order-0 md:flex-1 md:w-auto md:max-w-xl md:min-w-32">
            <div className="relative" ref={searchRef}>
              <input
                type="text"
                placeholder={t("搜索商品...")}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                className="input pr-12"
              />
              <button
                type="submit"
                aria-label={t('搜索')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-primary-600"
              >
                <FiSearch size={20} />
              </button>

              {/* 搜索下拉菜单 */}
              {showDropdown && (searchHistory.length > 0 || hotKeywords.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50">
                  {/* 搜索历史 */}
                  {isAuthenticated && searchHistory.length > 0 && (
                    <div className="p-3 border-b border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                          <FiClock size={14} />
                          {t("搜索历史")}</h4>
                      </div>
                      <div className="space-y-1">
                        {searchHistory.slice(0, 5).map((item: any, index: number) => (
                          <div
                            key={index}
                            className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-sm cursor-pointer group"
                            onClick={() => handleHistoryClick(item.keyword, true)}
                          >
                            <span className="text-sm text-gray-700">{item.keyword}</span>
                            <button
                              onClick={(e) => handleDeleteHistory(item.keyword, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-sm"
                              title={t("删除")}
                            >
                              <FiX size={14} className="text-gray-400" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 热搜榜 */}
                  {hotKeywords.length > 0 && (
                    <div className="p-3">
                      <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                        <FiTrendingUp size={14} />
                        {t("热门搜索")}</h4>
                      <div className="space-y-1">
                        {hotKeywords.slice(0, 5).map((item: any, index: number) => (
                          <div
                            key={index}
                            className="flex items-center px-3 py-2 hover:bg-gray-50 rounded-sm cursor-pointer"
                            onClick={() => handleHistoryClick(item.keyword)}
                          >
                            <span className={`text-xs font-bold mr-2 ${
                              index === 0 ? 'text-red-500' :
                              index === 1 ? 'text-orange-500' :
                              index === 2 ? 'text-yellow-600' :
                              'text-gray-400'
                            }`}>
                              {index + 1}
                            </span>
                            <span className="text-sm text-gray-700">{item.keyword}</span>
                            <span className="ml-auto text-xs text-gray-400">{t('{count}次', { count: item.search_count })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>
          {/* 右侧菜单 */}
          <div className="flex flex-wrap items-center gap-4">
            <LanguageSwitcher />
            {/* 优惠券 - 始终显示 */}
            <Link
              href={isAuthenticated ? "/coupons" : "/login"}
              className="flex items-center text-gray-700 hover:text-orange-500 transition"
              title={isAuthenticated ? t("优惠券") : t("登录领取优惠券")}
            >
              <FiGift size={22} />
            </Link>
            
            {/* 收藏 */}
            {isAuthenticated && (
              <Link
                href="/favorites"
                className="flex items-center text-gray-700 hover:text-red-500 transition"
                title={t("我的收藏")}
              >
                <FaHeart size={22} />
              </Link>
            )}

            {/* 购物车 */}
            <Link
              href="/cart"
              aria-label={t('购物车')}
              className="relative flex items-center text-gray-700 hover:text-primary-600"
            >
              <FiShoppingCart size={24} />
              {getTotalCount() > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {getTotalCount()}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/profile"
                  className="px-4 py-2 bg-linear-to-r/srgb from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all font-medium flex items-center gap-2 shadow-md hover:shadow-lg"
                >
                  <FiUser size={18} />
                  {t("我的")}</Link>
                <Link
                  href="/orders"
                  className="text-gray-700 hover:text-primary-600"
                >
                  {t("订单")}</Link>
                <Link
                  href="/history"
                  className="text-gray-700 hover:text-primary-600 flex items-center gap-1"
                >
                  <FiClock size={16} />
                  {t("足迹")}</Link>
                <div className="flex items-center space-x-2 text-gray-700">
                  <span>{user?.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-gray-700 hover:text-primary-600"
                  title={t("退出登录")}
                >
                  <FiLogOut size={20} />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="text-gray-700 hover:text-primary-600"
                >
                  {t("登录")}</Link>
                <Link
                  href="/register"
                  className="btn btn-primary"
                >
                  {t("注册")}</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
