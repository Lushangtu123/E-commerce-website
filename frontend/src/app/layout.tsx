import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { SITE_DESCRIPTION, SITE_NAME, isIndexable, siteUrl } from '@/lib/site';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Page titles and descriptions flow into og:/twitter: tags; only shared defaults live here.
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'zh_CN' },
  twitter: { card: 'summary' },
  robots: isIndexable() ? { index: true, follow: true } : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
