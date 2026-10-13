import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  getLanguageDirection,
  isRTL,
  isSupportedLanguage,
  normalizeLanguage,
  resolveLanguage,
  type LanguageCode,
  type LanguageDefinition,
  type TextDirection,
} from './languages';
import { LANGUAGE_STORAGE_KEY } from '../../theme/theme-context';

import enCommon from './locales/en/common.json';
import enCompose from './locales/en/compose.json';
import enConversation from './locales/en/conversation.json';
import enSettings from './locales/en/settings.json';
import enShell from './locales/en/shell.json';
import enGallery from './locales/en/gallery.json';
import arCommon from './locales/ar/common.json';
import arCompose from './locales/ar/compose.json';
import arConversation from './locales/ar/conversation.json';
import arSettings from './locales/ar/settings.json';
import arShell from './locales/ar/shell.json';
import arGallery from './locales/ar/gallery.json';
import zhCommon from './locales/zh-CN/common.json';
import zhCompose from './locales/zh-CN/compose.json';
import zhConversation from './locales/zh-CN/conversation.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhShell from './locales/zh-CN/shell.json';
import zhGallery from './locales/zh-CN/gallery.json';
import ruCommon from './locales/ru/common.json';
import ruCompose from './locales/ru/compose.json';
import ruConversation from './locales/ru/conversation.json';
import ruSettings from './locales/ru/settings.json';
import ruShell from './locales/ru/shell.json';
import ruGallery from './locales/ru/gallery.json';

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  getLanguageDirection,
  isRTL,
  isSupportedLanguage,
  normalizeLanguage,
  resolveLanguage,
  type LanguageCode,
  type LanguageDefinition,
  type TextDirection,
};

type Messages = Record<string, unknown>;

// Domain files must stay disjoint: a leaf collision throws at import time so
// a duplicated key can never silently shadow another domain's value.
function mergeMessages(...parts: Messages[]): Messages {
  const out: Messages = {};
  const merge = (target: Messages, source: Messages, path: string) => {
    for (const [key, value] of Object.entries(source)) {
      const at = path ? `${path}.${key}` : key;
      const existing = target[key];
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        merge(existing as Messages, value as Messages, at);
      } else if (existing === undefined) {
        target[key] = value;
      } else {
        throw new Error(`i18n resource collision at ${at}`);
      }
    }
  };
  for (const part of parts) merge(out, part, '');
  return out;
}

export const defaultResources = {
  en: {
    translation: mergeMessages(
      enCommon as Messages,
      enCompose as Messages,
      enConversation as Messages,
      enSettings as Messages,
      enShell as Messages,
      enGallery as Messages,
    ),
  },
  ar: {
    translation: mergeMessages(
      arCommon as Messages,
      arCompose as Messages,
      arConversation as Messages,
      arSettings as Messages,
      arShell as Messages,
      arGallery as Messages,
    ),
  },
  'zh-CN': {
    translation: mergeMessages(
      zhCommon as Messages,
      zhCompose as Messages,
      zhConversation as Messages,
      zhSettings as Messages,
      zhShell as Messages,
      zhGallery as Messages,
    ),
  },
  ru: {
    translation: mergeMessages(
      ruCommon as Messages,
      ruCompose as Messages,
      ruConversation as Messages,
      ruSettings as Messages,
      ruShell as Messages,
      ruGallery as Messages,
    ),
  },
};

function readStoredLanguage(): LanguageCode | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored && isSupportedLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistLanguage(lng: string): void {
  const code = normalizeLanguage(lng);
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Storage unavailable: in-memory language still drives this session.
  }
}

function detectLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const tags =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return resolveLanguage({ navigatorLanguages: tags });
}

// Stored choice wins; otherwise the navigator list decides; default last.
// Mirrors public/no-flash-theme.js so first paint and React agree.
const initialLanguage: LanguageCode = readStoredLanguage() ?? detectLanguage();

i18n.use(initReactI18next).init({
  resources: defaultResources,
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

// Synchronize document direction and lang attribute with active language
function syncDocumentDirection(lng: string) {
  if (typeof document !== 'undefined') {
    const code = normalizeLanguage(lng);
    document.documentElement.dir = getLanguageDirection(code);
    document.documentElement.lang = code;
  }
}

i18n.on('languageChanged', (lng) => {
  // Single persistence path: every language change (settings UI or
  // programmatic) is stored, so selection survives reopen.
  persistLanguage(lng);
  syncDocumentDirection(lng);
});

// Set initial document direction
syncDocumentDirection(initialLanguage);

export default i18n;
