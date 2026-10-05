import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Admin Console / 管理后台 - Store / 电商平台' },
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
