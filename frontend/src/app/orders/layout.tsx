import type { Metadata } from 'next';
import { TITLE_TEMPLATE } from '@/lib/site';

export const metadata: Metadata = { title: { default: '我的订单', template: TITLE_TEMPLATE }, robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
