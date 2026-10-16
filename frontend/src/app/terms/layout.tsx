import type { Metadata } from 'next';

export const metadata: Metadata = { title: '用户协议', alternates: { canonical: '/terms' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
