'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { SUPPORT_EMAIL, SUPPORT_PHONE, supportEmailHref, supportPhoneHref } from '@/lib/contact';

export interface InfoSection {
  title: string;
  body: string[];
}

interface InfoPageProps {
  title: string;
  intro: string;
  sections: InfoSection[];
}

const RELATED = [
  { href: '/help', label: '帮助中心' },
  { href: '/returns', label: '退换货政策' },
  { href: '/shipping', label: '配送说明' },
];

/** Static customer-service page; every string is a dictionary key. */
export default function InfoPage({ title, intro, sections }: InfoPageProps) {
  const { t } = useI18n();
  return (
    <div className="py-10 md:py-14">
      <div className="container-custom grid gap-10 lg:grid-cols-[1fr_16rem]">
        <article className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">{t(title)}</h1>
          <p className="mt-3 text-gray-600">{t(intro)}</p>
          <div className="mt-8 space-y-4">
            {sections.map((section) => (
              <section key={section.title} className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-base font-semibold text-gray-900">{t(section.title)}</h2>
                <div className="mt-2 space-y-2 text-sm leading-6 text-gray-600">
                  {section.body.map((line) => <p key={line}>{t(line)}</p>)}
                </div>
              </section>
            ))}
          </div>
        </article>

        <aside className="space-y-6 text-sm">
          <nav aria-label={t('客户服务')} className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">{t('客户服务')}</h2>
            <ul className="mt-3 space-y-2">
              {RELATED.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-gray-600 hover:text-primary-600">{t(item.label)}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">{t('联系我们')}</h2>
            <p className="mt-3 text-gray-600">{t('客服电话')}: <a href={supportPhoneHref} className="text-primary-600 hover:underline">{SUPPORT_PHONE}</a></p>
            <p className="mt-1 text-gray-600">{t('邮箱')}: <a href={supportEmailHref} className="text-primary-600 hover:underline">{SUPPORT_EMAIL}</a></p>
          </div>
        </aside>
      </div>
    </div>
  );
}
