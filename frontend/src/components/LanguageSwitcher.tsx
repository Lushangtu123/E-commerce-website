'use client';

import { useI18n } from '@/lib/i18n';
import { useLocaleStore, type Locale } from '@/store/useLocaleStore';

export default function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const setLocale = useLocaleStore((state) => state.setLocale);

  return (
    <select
      aria-label={t('界面语言')}
      title={t('界面语言')}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
      className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      <option value="zh-CN" lang="zh-CN">中文</option>
      <option value="en" lang="en">English</option>
    </select>
  );
}
