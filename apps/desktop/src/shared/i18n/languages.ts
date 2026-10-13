export type LanguageCode = 'en' | 'ar' | 'zh-CN' | 'ru';
export type TextDirection = 'ltr' | 'rtl';

export interface LanguageDefinition {
  code: LanguageCode;
  name: string;
  nativeName: string;
  dir: TextDirection;
}

export const SUPPORTED_LANGUAGES: Record<LanguageCode, LanguageDefinition> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English (US)',
    dir: 'ltr',
  },
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
  },
  'zh-CN': {
    code: 'zh-CN',
    name: 'Chinese',
    nativeName: '简体中文',
    dir: 'ltr',
  },
  ru: {
    code: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    dir: 'ltr',
  },
};

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

const SUPPORTED_CODES = new Set<string>(Object.keys(SUPPORTED_LANGUAGES));

/**
 * Normalize a BCP 47-ish tag to a supported language code.
 * Exact match wins; otherwise the base subtag decides (ar-* → ar,
 * zh-* → zh-CN, ru-* → ru, en-* → en); anything else falls back to default.
 * Single source of truth for tag handling — no-flash-theme.js mirrors this
 * subset in plain JS because it cannot import modules (see that file).
 */
export function normalizeLanguage(tag: string): LanguageCode {
  const lower = tag.toLowerCase().replace('_', '-');
  if (SUPPORTED_CODES.has(lower)) return lower as LanguageCode;
  const base = lower.split('-')[0];
  if (base === 'ar') return 'ar';
  if (base === 'zh') return 'zh-CN';
  if (base === 'ru') return 'ru';
  if (base === 'en') return 'en';
  return DEFAULT_LANGUAGE;
}

/** True only for codes the app can actually render. */
export function isSupportedLanguage(code: string): code is LanguageCode {
  return SUPPORTED_CODES.has(code);
}

/**
 * Resolve the startup language: an explicitly stored choice wins, then the
 * first navigator language that maps to a non-default language, else default.
 * Skipping default-mapping entries lets e.g. ['fr', 'ar-MA'] resolve to 'ar'
 * instead of stopping at French-mapped English.
 */
export function resolveLanguage(options?: {
  stored?: string | null;
  navigatorLanguages?: readonly string[];
}): LanguageCode {
  const { stored, navigatorLanguages = [] } = options ?? {};
  if (stored && isSupportedLanguage(stored)) return stored;
  for (const tag of navigatorLanguages) {
    const code = normalizeLanguage(tag);
    if (code !== DEFAULT_LANGUAGE) return code;
  }
  if (navigatorLanguages.length > 0) return normalizeLanguage(navigatorLanguages[0] ?? '');
  return DEFAULT_LANGUAGE;
}

export function getLanguageDirection(lang: string): TextDirection {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  if (base === 'ar') return 'rtl';
  return 'ltr';
}

export function isRTL(lang: string): boolean {
  return getLanguageDirection(lang) === 'rtl';
}
