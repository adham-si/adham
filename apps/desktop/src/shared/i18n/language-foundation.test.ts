import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getLanguageDirection,
  isRTL,
  isSupportedLanguage,
  normalizeLanguage,
  resolveLanguage,
} from './languages';

describe('language registry', () => {
  it('covers exactly English, Arabic, Chinese and Russian with directions', () => {
    expect(Object.keys(SUPPORTED_LANGUAGES).sort()).toEqual(['ar', 'en', 'ru', 'zh-CN']);
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(SUPPORTED_LANGUAGES.ar?.dir).toBe('rtl');
    for (const code of ['en', 'zh-CN', 'ru'] as const) {
      expect(SUPPORTED_LANGUAGES[code]?.dir).toBe('ltr');
    }
    for (const code of Object.keys(SUPPORTED_LANGUAGES)) {
      const def = SUPPORTED_LANGUAGES[code as keyof typeof SUPPORTED_LANGUAGES];
      expect(def?.nativeName.trim()).not.toBe('');
    }
  });

  it('normalizes BCP 47 tags to supported codes', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('ar')).toBe('ar');
    expect(normalizeLanguage('ar-MA')).toBe('ar');
    expect(normalizeLanguage('AR-eg')).toBe('ar');
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('zh-TW')).toBe('zh-CN');
    expect(normalizeLanguage('zh_Hans')).toBe('zh-CN');
    expect(normalizeLanguage('ru')).toBe('ru');
    expect(normalizeLanguage('ru-RU')).toBe('ru');
    expect(normalizeLanguage('fr')).toBe('en');
    expect(normalizeLanguage('')).toBe('en');
  });

  it('resolves stored choice first, then navigator order, then default', () => {
    expect(resolveLanguage({ stored: 'ar', navigatorLanguages: ['en'] })).toBe('ar');
    // Invalid stored values never win.
    expect(resolveLanguage({ stored: 'fr', navigatorLanguages: ['ar-MA'] })).toBe('ar');
    expect(resolveLanguage({ stored: null, navigatorLanguages: ['fr', 'ar-MA'] })).toBe('ar');
    expect(resolveLanguage({ stored: null, navigatorLanguages: ['en-US'] })).toBe('en');
    expect(resolveLanguage({ stored: null, navigatorLanguages: ['de'] })).toBe('en');
    expect(resolveLanguage({ stored: null, navigatorLanguages: [] })).toBe('en');
    expect(resolveLanguage()).toBe('en');
  });

  it('reports support and direction consistently', () => {
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('ar-MA')).toBe(false);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(getLanguageDirection('ar-MA')).toBe('rtl');
    expect(getLanguageDirection('AR')).toBe('rtl');
    expect(getLanguageDirection('en-US')).toBe('ltr');
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('zh-CN')).toBe(false);
  });
});
