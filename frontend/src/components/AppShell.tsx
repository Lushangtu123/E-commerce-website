'use client';

import { translateTitle, useI18n } from '@/lib/i18n';
import Header from '@/components/Header';
import SiteFooter from '@/components/SiteFooter';
import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { LOCALE_STORAGE_KEY, useLocaleStore } from '@/store/useLocaleStore';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { redactTelemetryUrl } from '@/lib/telemetry';

/** Client half of the root layout: language, session sync and storefront chrome. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/admin');
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrateLocale = useLocaleStore((state) => state.hydrate);

  // The server renders lang="zh-CN"; keep <html lang> in step with the chosen language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Server metadata titles are Chinese, and Next.js may set them after this effect
  // (streamed metadata, client navigation), so translate whenever the title changes.
  const sourceTitle = useRef<string | null>(null);
  const writtenTitle = useRef<string | null>(null);
  useEffect(() => {
    const sync = () => {
      if (sourceTitle.current === null || document.title !== writtenTitle.current) sourceTitle.current = document.title;
      const next = locale === 'en' ? translateTitle(sourceTitle.current, locale) : sourceTitle.current;
      writtenTitle.current = next;
      if (document.title !== next) document.title = next;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

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
    <>
      {!isAdminRoute && <Header />}
      <main className={`min-h-screen ${!isAdminRoute ? 'bg-gray-50' : ''}`}>
        {children}
      </main>
      {!isAdminRoute && <SiteFooter />}
      <Toaster position="top-center" />
      <Analytics beforeSend={redactTelemetryUrl} />
      <SpeedInsights beforeSend={redactTelemetryUrl} />
    </>
  );
}
