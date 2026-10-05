'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { logger } from '@/lib/logger';

/** Shown inside the site layout when a page throws while rendering. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    logger.error('页面渲染失败:', error);
  }, [error]);

  return (
    <div className="container-custom py-20 text-center" role="alert">
      <h1 className="text-2xl font-bold mb-3">{t('页面出错了')}</h1>
      <p className="text-gray-600 mb-6">{t('页面暂时无法显示，请重试或返回首页。')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">{t('重试')}</button>
        <Link href="/" className="btn btn-secondary">{t('返回首页')}</Link>
      </div>
      {/* Server errors only expose this hash; it matches the entry in the server logs. */}
      {error.digest && <p className="mt-8 text-xs text-gray-500">{t('错误编号：{digest}', { digest: error.digest })}</p>}
    </div>
  );
}
