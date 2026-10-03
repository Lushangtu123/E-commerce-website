'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container-custom py-20 text-center">
      <p className="text-6xl font-bold text-primary-600 mb-4">404</p>
      <h1 className="text-2xl font-bold mb-3">{t('页面不存在')}</h1>
      <p className="text-gray-600 mb-6">{t('您访问的页面不存在或已移除')}</p>
      <Link href="/" className="btn btn-primary">{t('返回首页')}</Link>
    </div>
  );
}
