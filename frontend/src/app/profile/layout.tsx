import type { Metadata } from 'next';

export const metadata: Metadata = { title: '个人中心', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
