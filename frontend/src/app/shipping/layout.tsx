import type { Metadata } from 'next';

export const metadata: Metadata = { title: '配送说明', alternates: { canonical: '/shipping' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
