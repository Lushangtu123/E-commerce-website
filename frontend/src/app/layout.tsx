'use client';

import { useI18n } from '@/lib/i18n';

import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { LOCALE_STORAGE_KEY, useLocaleStore } from '@/store/useLocaleStore';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { redactTelemetryUrl } from '@/lib/telemetry';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/admin');
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrateLocale = useLocaleStore((state) => state.hydrate);

  useEffect(() => {
    if (!isAdminRoute) document.title = t('电商平台');
  }, [locale, isAdminRoute]);

  useEffect(() => {
    hydrateLocale();
    const syncLocale = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === null || event.key === LOCALE_STORAGE_KEY)) {
        hydrateLocale();
      }
    };
    window.addEventListener('storage', syncLocale);
    return () => window.removeEventListener('storage', syncLocale);
  }, [hydrateLocale]);
  
  // 在客户端首次渲染时从localStorage加载状态
  useEffect(() => {
    hydrate();
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === null || event.key === 'token' || event.key === 'user')) {
        hydrate();
      }
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, [hydrate]);

  return (
    <html lang={locale}>
      <body className={inter.className}>
        {!isAdminRoute && <Header />}
        <main className={`min-h-screen ${!isAdminRoute ? 'bg-gray-50' : ''}`}>
          {children}
        </main>
        {!isAdminRoute && (
          <footer className="bg-gray-800 text-white py-8">
            <div className="container-custom">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                <div>
                  <h3 className="font-bold text-lg mb-4">{t("关于我们")}</h3>
                  <p className="text-gray-400">{t("专业的电商平台，为您提供优质的购物体验")}</p>
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-4">{t("客户服务")}</h3>
                  <ul className="space-y-2 text-gray-400">
                    <li>{t("帮助中心")}</li>
                    <li>{t("退换货政策")}</li>
                    <li>{t("配送说明")}</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-4">{t("联系我们")}</h3>
                  <ul className="space-y-2 text-gray-400">
                    <li>{t("客服电话: 400-123-4567")}</li>
                    <li>{t("邮箱: service@example.com")}</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-4">{t("关注我们")}</h3>
                  <p className="text-gray-400">{t("获取最新优惠信息")}</p>
                </div>
              </div>
              <div className="mt-8 pt-8 border-t border-gray-700 text-center text-gray-400">
                <p>{t("© 2025 电商平台. All rights reserved.")}</p>
              </div>
            </div>
          </footer>
        )}
        <Toaster position="top-center" />
        <Analytics beforeSend={redactTelemetryUrl} />
        <SpeedInsights beforeSend={redactTelemetryUrl} />
      </body>
    </html>
  );
}
