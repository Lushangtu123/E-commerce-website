'use client';

import InfoPage from '@/components/InfoPage';
import { USER_AGREEMENT } from '@/lib/legal-content';

export default function TermsPage() {
  return <InfoPage {...USER_AGREEMENT} />;
}
