import type { Metadata } from 'next';

export const metadata: Metadata = { title: '订单详情', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
