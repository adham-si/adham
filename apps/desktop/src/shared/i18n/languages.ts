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

export function getLanguageDirection(lang: string): TextDirection {
  if (lang.startsWith('ar')) return 'rtl';
  return 'ltr';
}

export function isRTL(lang: string): boolean {
  return getLanguageDirection(lang) === 'rtl';
}
