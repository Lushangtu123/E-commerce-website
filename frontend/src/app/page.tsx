import type { Metadata } from 'next';
import HomePage from '@/components/HomePage';

// Set on the page, not the root layout, so other routes never inherit the home canonical.
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function Page() {
  return <HomePage />;
}
