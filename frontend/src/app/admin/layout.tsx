import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Console / 管理后台 - Store / 电商平台',
  description: 'Store administration / 电商平台管理后台',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
