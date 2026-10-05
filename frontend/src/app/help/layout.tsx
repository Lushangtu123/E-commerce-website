import type { Metadata } from 'next';

export const metadata: Metadata = { title: '帮助中心', alternates: { canonical: '/help' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
