import type { Metadata } from 'next';

export const metadata: Metadata = { title: '优惠券中心', alternates: { canonical: '/coupons' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
