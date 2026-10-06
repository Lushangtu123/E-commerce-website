'use client';

import { useLocaleStore, type Locale } from '@/store/useLocaleStore';
import { commonTranslations } from '@/lib/common-translations';
import { accountTranslations } from '@/lib/account-translations';
import { errorTranslations } from '@/lib/error-translations';

// The storefront dictionaries ship with every page; the admin pages add theirs through `@/lib/admin-i18n`.
const english: Record<string, string> = { ...errorTranslations, ...accountTranslations, ...commonTranslations };

/** Adds a section's English strings; a section only holds keys the shared dictionaries lack (see tests/i18n.test.tsx). */
export function registerTranslations(dictionary: Record<string, string>) {
  Object.assign(english, dictionary);
}
type Params = Record<string, string | number>;

// Only match known server message templates; product names stay literal.
const errorTemplates = Object.entries(errorTranslations).filter(([key]) => /\{\w+\}/.test(key)).map(([key, value]) => {
  const names: string[] = [];
  const escaped = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\{(\w+)\}/g, (_, name) => {
    names.push(name);
    return '([\\s\\S]+?)';
  });
  return { pattern: new RegExp(`^${pattern}$`), names, value };
});

export function translate(key: string, params: Params = {}, locale: Locale = useLocaleStore.getState().locale): string {
  let text = locale === 'en' ? english[key] ?? key : key;
  if (locale === 'en' && !Object.hasOwn(english, key)) {
    for (const template of errorTemplates) {
      const match = template.pattern.exec(key);
      if (match) {
        text = template.value;
        params = Object.fromEntries(template.names.map((name, i) => [name, match[i + 1]]));
        break;
      }
    }
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

const TITLE_SEPARATOR = ' | ';

/** Server titles are Chinese ("页面 | 电商平台"); each part is translated, product names stay literal. */
export function translateTitle(title: string, locale: Locale = useLocaleStore.getState().locale): string {
  return title.split(TITLE_SEPARATOR).map((part) => translate(part, {}, locale)).join(TITLE_SEPARATOR);
}

export function formatDate(value: string | number | Date | null | undefined, dateOnly = false, options: Intl.DateTimeFormatOptions = {}): string {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = useLocaleStore.getState().locale === 'en' ? 'en-US' : 'zh-CN';
  return dateOnly ? date.toLocaleDateString(locale, options) : date.toLocaleString(locale, options);
}

export function useI18n() {
  const locale = useLocaleStore((state) => state.locale);
  // Stable functions also read the latest language when asynchronous requests finish.
  return { locale, t: translate, formatDate };
}
