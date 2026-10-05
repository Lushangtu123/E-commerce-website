'use client';

import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { ADMIN_SESSION_EVENT, clearAdminSession, getAdminSession, getAdminSessionToken, type AdminSession } from '@/lib/admin-session';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname() || '';
  const [storedAdmin, setAdmin] = useState<AdminSession['admin'] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(() => getAdminSessionToken());
  const mounted = useRef(false);

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = t('管理后台 - 电商平台');
  }, [locale, t]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const syncSession = () => {
      if (!active) return;
      const next = getAdminSession();
      setAdmin(next?.admin ?? null);
      setSessionToken(next?.token ?? null);
      if (!next) router.push('/admin/login');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'admin_token' || event.key === 'admin_user') syncSession();
    };
    syncSession();
    window.addEventListener?.('storage', onStorage);
    window.addEventListener?.(ADMIN_SESSION_EVENT, syncSession);
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener?.('storage', onStorage);
      window.removeEventListener?.(ADMIN_SESSION_EVENT, syncSession);
    };
  }, [router, pathname]);

  const handleLogout = () => {
    if (!mounted.current || !sessionToken || getAdminSessionToken() !== sessionToken) return;
    clearAdminSession(sessionToken);
    setAdmin(null);
    setSessionToken(null);
    router.push('/admin/login');
  };

  const menuItems = [
    {
      name: t("仪表盘"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      path: '/admin/dashboard'
    },
    {
      name: t("商品管理"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      path: '/admin/products'
    },
    {
      name: t("订单管理"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      path: '/admin/orders'
    },
    {
      name: t('售后管理'),
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10H4l5-5m-5 5a8 8 0 111 7" /></svg>,
      path: '/admin/after-sales'
    },
    {
      name: t("优惠券管理"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V7zm10 0v2m0 4v2m0 2v2" />
        </svg>
      ),
      path: '/admin/coupons'
    },
    {
      name: t("用户管理"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      path: '/admin/users'
    },
    {
      name: t("操作日志"),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      path: '/admin/logs'
    }
  ];

  const current = getAdminSession();
  if (!storedAdmin || !current || current.token !== sessionToken) {
    return <div className="min-h-screen flex items-center justify-center">{t("加载中...")}</div>;
  }
  const admin = current.admin;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 侧边栏 */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 bg-gray-800">
          <span className="text-xl font-bold">{t("管理后台")}</span>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label={t('关闭侧栏')}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 导航菜单 */}
        <nav className="mt-6 px-3">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center px-4 py-3 mb-2 rounded-lg transition-colors ${
                pathname === item.path || pathname.startsWith(`${item.path}/`)
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="ml-3">{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* 底部用户信息 */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gray-800">
          <div className="flex items-center mb-2">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
              {admin.real_name?.[0] || admin.username[0].toUpperCase()}
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium">{admin.real_name || admin.username}</p>
              <p className="text-xs text-gray-400">{admin.role_name}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {t("退出登录")}
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className={`transition-all duration-300 ${sidebarOpen ? 'lg:ml-64' : 'ml-0'}`}>
        {/* 顶部栏 */}
        <div className="bg-white shadow-xs h-16 flex items-center justify-between px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={t('切换侧栏')}
            className="text-gray-600 hover:text-gray-900"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <a
              href="/"
              target="_blank"
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              {t("前往商城")}
            </a>
          </div>
        </div>

        {/* 页面内容 */}
        <div key={sessionToken} className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
