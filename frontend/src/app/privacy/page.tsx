'use client';

import InfoPage from '@/components/InfoPage';
import { PRIVACY_POLICY } from '@/lib/legal-content';

export default function PrivacyPage() {
  return <InfoPage {...PRIVACY_POLICY} />;
}
