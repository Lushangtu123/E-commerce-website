import type { Metadata } from 'next';
import { TITLE_TEMPLATE } from '@/lib/site';

export const metadata: Metadata = { title: { default: '全部商品', template: TITLE_TEMPLATE }, alternates: { canonical: '/products' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
