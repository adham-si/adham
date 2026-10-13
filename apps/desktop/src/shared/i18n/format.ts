import i18n from 'i18next';
import { normalizeLanguage } from './languages';

/** Active app language as a BCP 47 tag suitable for Intl APIs. */
export function activeLocale(): string {
  if (i18n.language) return normalizeLanguage(i18n.language);
  return 'en';
}

/** Locale-aware integer/grouped-number formatting (never falls back to OS locale). */
export function formatNumber(value: number, lng?: string, opts?: Intl.NumberFormatOptions): string {
  const locale = lng ?? activeLocale();
  // Pin Arabic-Indic digits for Arabic so Node and WebKit render identically;
  // other locales follow their CLDR defaults. Deliberate, tested below.
  const numberingSystem = normalizeLanguage(locale) === 'ar' ? 'arab' : undefined;
  return new Intl.NumberFormat(locale, { numberingSystem, ...opts }).format(value);
}

/** Locale-aware short clock time for message timestamps. */
export function formatTime(value: Date | number | string, lng?: string): string {
  return new Date(value).toLocaleTimeString(lng ?? activeLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Locale-aware relative time ("now", "1 min ago", …) with correct grammar.
 * Intl.RelativeTimeFormat carries Arabic/Russian plural rules, so no
 * resource-side plural forms are needed for these demo/activity strings.
 */
export function formatRelativeTime(
  when: Date | number,
  now: number = Date.now(),
  lng?: string,
): string {
  const diffSeconds = Math.round((new Date(when).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(lng ?? activeLocale(), { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return formatter.format(diffSeconds <= 0 ? 0 : 1, 'second');
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  return formatter.format(Math.round(diffSeconds / 86400), 'day');
}
