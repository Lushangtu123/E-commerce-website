import type { Metadata } from 'next';

export const metadata: Metadata = { title: '退换货政策', alternates: { canonical: '/returns' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
