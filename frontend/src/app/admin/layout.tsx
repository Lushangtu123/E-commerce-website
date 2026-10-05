import type { Metadata } from 'next';
import { TITLE_TEMPLATE } from '@/lib/site';

export const metadata: Metadata = {
  title: { default: '管理后台', template: TITLE_TEMPLATE },
  robots: { index: false, follow: false },
  description: 'Store administration / 电商平台管理后台',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
