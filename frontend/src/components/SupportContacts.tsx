'use client';

import { supportContacts } from '@/lib/contact';
import { useI18n } from '@/lib/i18n';

export default function SupportContacts({ linkClassName }: { linkClassName: string }) {
  const { t } = useI18n();
  const { phone, email, phoneHref, emailHref } = supportContacts();
  return (
    <ul className="mt-3 space-y-2 text-sm text-gray-500">
      {phone && <li>{t('客服电话')}: <a href={phoneHref} className={linkClassName}>{phone}</a></li>}
      {email && <li>{t('邮箱')}: <a href={emailHref} className={linkClassName}>{email}</a></li>}
      {!phone && !email && <li>{t('客服联系方式暂未公布')}</li>}
    </ul>
  );
}
