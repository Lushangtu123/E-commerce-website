import type { Metadata } from 'next';

export const metadata: Metadata = { title: '重置密码', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
