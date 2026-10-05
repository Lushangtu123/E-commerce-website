'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="container-custom py-20 text-center">
      {/* not-found has no metadata export; React hoists this into <head>. */}
      <title>{`${t('页面不存在')} | ${t('电商平台')}`}</title>
      <p className="text-6xl font-bold text-primary-600 mb-4">404</p>
      <h1 className="text-2xl font-bold mb-3">{t('页面不存在')}</h1>
      <p className="text-gray-600 mb-6">{t('您访问的页面不存在或已移除')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary">{t('返回首页')}</Link>
        <Link href="/products" className="btn btn-secondary">{t('全部商品')}</Link>
      </div>
    </div>
  );
}
