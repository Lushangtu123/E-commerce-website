import type { Metadata } from 'next';

export const metadata: Metadata = { title: '全部商品', alternates: { canonical: '/products' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
