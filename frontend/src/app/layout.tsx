import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { SITE_DESCRIPTION, SITE_NAME, TITLE_TEMPLATE, isIndexable, siteUrl } from '@/lib/site';

// Inter covers Latin text only; globals.css lists the Chinese fonts that follow it.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_NAME, template: TITLE_TEMPLATE },
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
      <body className={inter.variable}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
