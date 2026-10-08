import type { Locale } from '@/store/useLocaleStore';

/** Translations are keyed by the original attribute, so partial translations keep their identity. */
export type SpecTranslations = Record<string, { name?: string; value?: string }>;

export function localizedText(original: string | null | undefined, english: string | null | undefined, locale: Locale): string {
  return locale === 'en' && english?.trim() ? english : original ?? '';
}

export function localizedSpecs(specs: Record<string, unknown> | null | undefined, translations: SpecTranslations | null | undefined, locale: Locale): [string, unknown][] {
  return Object.entries(specs ?? {}).map(([name, value]) => {
    const english = locale === 'en' && translations && Object.hasOwn(translations, name) ? translations[name] : undefined;
    return [english?.name?.trim() ? english.name : name,
      typeof value === 'string' && english?.value?.trim() ? english.value : value];
  });
}

export function specValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
}

export function specSummary(specs: Record<string, unknown> | null | undefined, translations: SpecTranslations | null | undefined, locale: Locale): string {
  return localizedSpecs(specs, translations, locale).map(([name, value]) => `${name}: ${specValue(value)}`).join(' / ');
}
