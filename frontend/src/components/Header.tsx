'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { FiShoppingCart, FiUser, FiSearch, FiLogOut, FiClock, FiX, FiTrendingUp } from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchApi } from '@/lib/api';

export default function Header() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const { getTotalCount } = useCartStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchHistory, setSearchHistory] = useState<any[]>([]);
  const [hotKeywords, setHotKeywords] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 只在初次挂载时加载
    if (isAuthenticated) {
      fetchSearchHistory();
    }
    fetchHotKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 移除isAuthenticated依赖，避免无限循环

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
    try {
      const data: any = await searchApi.getHistory(10);
      setSearchHistory(data.history || []);
    } catch (error) {
      console.error('获取搜索历史失败:', error);
    }
  };

  const fetchHotKeywords = async () => {
    try {
      const data: any = await searchApi.getHot(7, 10);
      setHotKeywords(data.keywords || []);
    } catch (error) {
      console.error('获取热搜失败:', error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchKeyword.trim()) {
      setShowDropdown(false);
      router.push(`/products?keyword=${encodeURIComponent(searchKeyword)}`);
      // 记录搜索历史
      if (isAuthenticated) {
        try {
          await searchApi.record(searchKeyword.trim());
          fetchSearchHistory();
        } catch (error) {
          console.error('记录搜索历史失败:', error);
        }
      }
    }
  };

  const handleHistoryClick = (keyword: string) => {
    setSearchKeyword(keyword);
    setShowDropdown(false);
    router.push(`/products?keyword=${encodeURIComponent(keyword)}`);
  };

  const handleDeleteHistory = async (keyword: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await searchApi.deleteKeyword(keyword);
      fetchSearchHistory();
    } catch (error) {
      console.error('删除搜索记录失败:', error);
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
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="container-custom py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="text-2xl font-bold text-primary-600">
            电商平台
          </Link>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-8">
            <div className="relative" ref={searchRef}>
              <input
                type="text"
                placeholder="搜索商品..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                className="input pr-12"
              />
              <button
                type="submit"
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
                          搜索历史
                        </h4>
                      </div>
                      <div className="space-y-1">
                        {searchHistory.slice(0, 5).map((item: any, index: number) => (
                          <div
                            key={index}
                            className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded cursor-pointer group"
                            onClick={() => handleHistoryClick(item.keyword)}
                          >
                            <span className="text-sm text-gray-700">{item.keyword}</span>
                            <button
                              onClick={(e) => handleDeleteHistory(item.keyword, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded"
                              title="删除"
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
                        热门搜索
                      </h4>
                      <div className="space-y-1">
                        {hotKeywords.slice(0, 5).map((item: any, index: number) => (
                          <div
                            key={index}
                            className="flex items-center px-3 py-2 hover:bg-gray-50 rounded cursor-pointer"
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
                            <span className="ml-auto text-xs text-gray-400">{item.search_count}次</span>
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
          <div className="flex items-center space-x-6">
            {/* 收藏 */}
            {isAuthenticated && (
              <Link
                href="/favorites"
                className="flex items-center text-gray-700 hover:text-red-500 transition"
                title="我的收藏"
              >
                <FaHeart size={22} />
              </Link>
            )}

            {/* 购物车 */}
            <Link
              href="/cart"
              className="relative flex items-center space-x-1 text-gray-700 hover:text-primary-600"
            >
              <FiShoppingCart size={24} />
              {getTotalCount() > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {getTotalCount()}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <div className="flex items-center space-x-4">
                <Link
                  href="/orders"
                  className="text-gray-700 hover:text-primary-600"
                >
                  我的订单
                </Link>
                <Link
                  href="/history"
                  className="text-gray-700 hover:text-primary-600 flex items-center gap-1"
                >
                  <FiClock size={16} />
                  足迹
                </Link>
                <div className="flex items-center space-x-2">
                  <FiUser size={20} className="text-gray-700" />
                  <span className="text-gray-700">{user?.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-gray-700 hover:text-primary-600"
                >
                  <FiLogOut size={20} />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link
                  href="/login"
                  className="text-gray-700 hover:text-primary-600"
                >
                  登录
                </Link>
                <Link
                  href="/register"
                  className="btn btn-primary"
                >
                  注册
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

