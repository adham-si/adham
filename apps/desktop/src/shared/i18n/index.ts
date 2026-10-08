import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  getLanguageDirection,
  isRTL,
  type LanguageCode,
  type LanguageDefinition,
  type TextDirection,
} from './languages';

import enMessages from './locales/en/messages.json';
import arMessages from './locales/ar/messages.json';
import zhMessages from './locales/zh-CN/messages.json';
import ruMessages from './locales/ru/messages.json';

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  getLanguageDirection,
  isRTL,
  type LanguageCode,
  type LanguageDefinition,
  type TextDirection,
};

export const defaultResources = {
  en: { translation: enMessages },
  ar: { translation: arMessages },
  'zh-CN': { translation: zhMessages },
  ru: { translation: ruMessages },
};

// Initial language detection
const detectedLang =
  typeof navigator !== 'undefined' && navigator.language.startsWith('ar') ? 'ar' : DEFAULT_LANGUAGE;

i18n.use(initReactI18next).init({
  resources: defaultResources,
  lng: detectedLang,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

// Synchronize document direction and lang attribute with active language
function syncDocumentDirection(lng: string) {
  if (typeof document !== 'undefined') {
    const dir = getLanguageDirection(lng);
    document.documentElement.dir = dir;
    document.documentElement.lang = lng;
  }
}

i18n.on('languageChanged', (lng) => {
  syncDocumentDirection(lng);
});

// Set initial document direction
syncDocumentDirection(detectedLang);

export default i18n;
