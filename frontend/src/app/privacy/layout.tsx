import type { Metadata } from 'next';

export const metadata: Metadata = { title: '隐私政策', alternates: { canonical: '/privacy' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
