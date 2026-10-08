'use client';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { translate, useI18n } from '@/lib/i18n';

import Link from 'next/link';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { signOut } from '@/lib/sign-out';
import { useCartStore } from '@/store/useCartStore';
import { FiShoppingCart, FiUser, FiSearch, FiLogOut, FiClock, FiX, FiTrendingUp, FiGift, FiHeart, FiShoppingBag } from 'react-icons/fi';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchApi, type HotKeyword, type SearchKeyword } from '@/lib/api';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

export default function Header() {
  const { t } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const { getTotalCount } = useCartStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [history, setHistory] = useState<{ scope: string | null; rows: SearchKeyword[] }>({ scope: null, rows: [] });
  const [hotKeywords, setHotKeywords] = useState<HotKeyword[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const historyRequest = useRef(0);
  const scope = isHydrated && isAuthenticated && sessionId && user ? JSON.stringify([sessionId, user.user_id]) : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const isCurrentSession = () => {
    const auth = useAuthStore.getState();
    try {
      return mounted.current && !!scope && currentScope.current === scope && auth.isHydrated && auth.isAuthenticated &&
        auth.sessionId === sessionId && auth.user?.user_id === user?.user_id && storedSessionId() === sessionId;
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
      const data = await searchApi.getHistory(10);
      if (isCurrentSession() && request === historyRequest.current) {
        setHistory({ scope, rows: data.history || [] });
      }
    } catch (error) {
      if (isCurrentSession() && request === historyRequest.current) logger.error('获取搜索历史失败:', error);
    }
  };

  const fetchHotKeywords = async () => {
    try {
      const data = await searchApi.getHot(7, 10);
      if (mounted.current) setHotKeywords(data.keywords || []);
    } catch (error) {
      logger.error('获取热搜失败:', error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyword = searchKeyword.trim();
    if (keyword.length > 100) {
      toast.error(translate('搜索关键词最多100个字符'));
      return;
    }
    if (keyword) {
      setShowDropdown(false);
      router.push(`/products?keyword=${encodeURIComponent(keyword)}`);
      // 记录搜索历史
      if (isCurrentSession()) {
        try {
          await searchApi.record(keyword);
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

  const handleLogout = async () => {
    // A full page load would cancel the request that clears the session cookie, so wait for it.
    await signOut();
    window.location.href = '/';
  };

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-md">
      <div className="container-custom py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 rounded-lg text-gray-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
              <FiShoppingBag size={18} aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight">{t("电商平台")}</span>
          </Link>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} role="search" className="order-last w-full md:order-0 md:flex-1 md:w-auto md:max-w-xl md:min-w-32">
            <div className="relative" ref={searchRef}>
              <input
                type="text"
                maxLength={100}
                placeholder={t("搜索商品...")}
                aria-label={t("搜索商品")}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                className="input h-10 rounded-full bg-gray-50 pr-12 text-sm focus:bg-white"
              />
              <button
                type="submit"
                aria-label={t('搜索')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <FiSearch size={18} />
              </button>

              {/* 搜索下拉菜单 */}
              {showDropdown && (searchHistory.length > 0 || hotKeywords.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg ring-1 ring-gray-200 max-h-96 overflow-y-auto z-50">
                  {/* 搜索历史 */}
                  {isAuthenticated && searchHistory.length > 0 && (
                    <div className="p-3 border-b border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                          <FiClock size={14} />
                          {t("搜索历史")}</h4>
                      </div>
                      <div className="space-y-1">
                        {searchHistory.slice(0, 5).map((item, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-sm cursor-pointer group"
                          >
                            <button type="button" onClick={() => handleHistoryClick(item.keyword, true)}
                              className="flex-1 text-left text-sm text-gray-700 focus-visible:outline-2 focus-visible:outline-primary-500">
                              <span>{item.keyword}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteHistory(item.keyword, e)}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 hover:bg-gray-200 rounded-sm"
                              title={t("删除")}
                              aria-label={t('删除搜索历史：{keyword}', { keyword: item.keyword })}
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
                        {hotKeywords.slice(0, 5).map((item, index) => (
                          <button type="button"
                            key={index}
                            className="flex w-full items-center px-3 py-2 hover:bg-gray-50 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-primary-500"
                            onClick={() => handleHistoryClick(item.keyword)}
                          >
                            <span className={`text-xs font-bold mr-2 ${
                              index === 0 ? 'text-red-500' :
                              index === 1 ? 'text-orange-500' :
                              index === 2 ? 'text-yellow-600' :
                              'text-gray-500'
                            }`}>
                              {index + 1}
                            </span>
                            <span className="text-sm text-gray-700">{item.keyword}</span>
                            <span className="ml-auto text-xs text-gray-500">{t('{count}次', { count: item.search_count })}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>
          {/* 右侧菜单 */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            {/* 优惠券 - 始终显示 */}
            <Link
              href={isAuthenticated ? "/coupons" : "/login"}
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title={isAuthenticated ? t("优惠券") : t("登录领取优惠券")}
              aria-label={isAuthenticated ? t("优惠券") : t("登录领取优惠券")}
            >
              <FiGift size={20} />
            </Link>
            
            {/* 收藏 */}
            {isAuthenticated && (
              <Link
                href="/favorites"
                className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                title={t("我的收藏")}
                aria-label={t("我的收藏")}
              >
                <FiHeart size={20} />
              </Link>
            )}

            {/* 购物车 */}
            <Link
              href="/cart"
              aria-label={t('购物车')}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <FiShoppingCart size={20} />
              {getTotalCount() > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1 text-[11px] font-semibold text-white ring-2 ring-white">
                  {getTotalCount()}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                <Link
                  href="/profile"
                  className="ml-1 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-gray-800 ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50"
                >
                  <FiUser size={16} />
                  {t("我的")}</Link>
                <Link
                  href="/orders"
                  className="rounded-full px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  {t("订单")}</Link>
                <Link
                  href="/history"
                  className="flex items-center gap-1 rounded-full px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  <FiClock size={15} />
                  {t("足迹")}</Link>
                <span className="hidden max-w-32 truncate px-1 text-sm text-gray-500 lg:inline">{user?.username}</span>
                <button
                  onClick={handleLogout}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  title={t("退出登录")}
                  aria-label={t("退出登录")}
                >
                  <FiLogOut size={18} />
                </button>
              </div>
            ) : (
              <div className="ml-1 flex flex-wrap items-center gap-2">
                <Link
                  href="/login"
                  className="rounded-full px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  {t("登录")}</Link>
                <Link
                  href="/register"
                  className="btn btn-primary rounded-full text-sm"
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
