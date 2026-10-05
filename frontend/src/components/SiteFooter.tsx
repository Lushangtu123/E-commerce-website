'use client';

import Link from 'next/link';
import { FiShoppingBag } from 'react-icons/fi';
import { useI18n } from '@/lib/i18n';
import { SUPPORT_EMAIL, SUPPORT_PHONE, supportEmailHref, supportPhoneHref } from '@/lib/contact';

const linkClass = 'transition-colors hover:text-gray-900';

export default function SiteFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="container-custom py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex w-fit items-center gap-2 text-gray-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                <FiShoppingBag size={16} aria-hidden="true" />
              </span>
              <span className="font-semibold tracking-tight">{t("电商平台")}</span>
            </Link>
            <p className="mt-3 text-sm leading-6 text-gray-500">{t("专业的电商平台，为您提供优质的购物体验")}</p>
          </div>
          <nav aria-label={t("客户服务")}>
            <h2 className="text-sm font-semibold text-gray-900">{t("客户服务")}</h2>
            <ul className="mt-3 space-y-2 text-sm text-gray-500">
              <li><Link href="/help" className={linkClass}>{t("帮助中心")}</Link></li>
              <li><Link href="/returns" className={linkClass}>{t("退换货政策")}</Link></li>
              <li><Link href="/shipping" className={linkClass}>{t("配送说明")}</Link></li>
            </ul>
          </nav>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t("联系我们")}</h2>
            <ul className="mt-3 space-y-2 text-sm text-gray-500">
              <li>{t("客服电话")}: <a href={supportPhoneHref} className={linkClass}>{SUPPORT_PHONE}</a></li>
              <li>{t("邮箱")}: <a href={supportEmailHref} className={linkClass}>{SUPPORT_EMAIL}</a></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t("关注我们")}</h2>
            <Link href="/coupons" className={`mt-3 block text-sm text-gray-500 ${linkClass}`}>{t("获取最新优惠信息")}</Link>
          </div>
        </div>
        <div className="mt-10 border-t border-gray-200 pt-6 text-sm text-gray-500">
          <p>{t("© {year} 电商平台. All rights reserved.", { year })}</p>
        </div>
      </div>
    </footer>
  );
}
