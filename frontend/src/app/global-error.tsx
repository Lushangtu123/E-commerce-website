'use client';

import { useEffect } from 'react';
import './globals.css';
import { translate } from '@/lib/i18n';
import { logger } from '@/lib/logger';

/**
 * Replaces the root layout when the layout itself fails, so it renders its own
 * document and stylesheet and avoids the app shell (header, stores) that may be broken.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    logger.error('应用渲染失败:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="bg-gray-50">
        <title>{`${translate('页面出错了')} | ${translate('电商平台')}`}</title>
        <main className="container-custom py-20 text-center" role="alert">
          <h1 className="text-2xl font-bold mb-3">{translate('页面出错了')}</h1>
          <p className="text-gray-600 mb-6">{translate('页面暂时无法显示，请重试或返回首页。')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => retry()} className="btn btn-primary">{translate('重试')}</button>
            {/* A full page load on purpose: client navigation depends on the layout that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="btn btn-secondary">{translate('返回首页')}</a>
          </div>
          {error.digest && <p className="mt-8 text-xs text-gray-500">{translate('错误编号：{digest}', { digest: error.digest })}</p>}
        </main>
      </body>
    </html>
  );
}
