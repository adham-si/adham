import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import i18n, { defaultResources } from './index';

type Lang = 'en' | 'ar' | 'zh-CN' | 'ru';
const LOCALES: Lang[] = ['en', 'ar', 'zh-CN', 'ru'];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// All statically-used keys across app sources (tests and gallery excluded:
// gallery registers its own `gallery.*` namespace at runtime).
function collectUsedKeys(): string[] {
  const modules = import.meta.glob('../../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const keys = new Set<string>();
  for (const [file, source] of Object.entries(modules)) {
    if (file.includes('.test.') || file.includes('.spec.') || file.includes('/gallery/')) continue;
    // Strip line/block comments so dead examples cannot fake coverage.
    const clean = (source as string)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    for (const match of clean.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = match[1];
      if (key && !key.includes(':') && !key.startsWith('gallery.')) {
        keys.add(key);
      }
    }
    for (const match of clean.matchAll(/\b(?:labelKey|unavailableKey):\s*'([^']+)'/g)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
  return [...keys].sort();
}

function resourceValue(language: Lang, key: string): unknown {
  let value: unknown = defaultResources[language].translation;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

// Dynamic runtime keys (messageKey routing, effort tiers): asserted explicitly.
const DYNAMIC_KEYS = [
  'error.validationFailed',
  'error.invalidProtocolVersion',
  'error.workspaceNotFound',
  'error.projectNotFound',
  'error.sessionNotFound',
  'error.contextMismatch',
  'error.requestIdConflict',
  'error.preferencesConflict',
  'error.notSaved',
];

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((s): s is string => typeof s === 'string')
    .sort();
}

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

async function translator(language: string, fallbackLng: string | false = false) {
  const instance = createInstance();
  await instance.init({
    resources: defaultResources,
    lng: language,
    fallbackLng,
    interpolation: i18n.options.interpolation ?? {},
  });
  return instance;
}

describe('desktop localization coverage (all selectable languages)', () => {
  const usedKeys = collectUsedKeys();

  it('uses a non-trivial audited key inventory', () => {
    expect(usedKeys.length).toBeGreaterThan(200);
    for (const key of [
      'compose.newSession',
      'sessions',
      'compose.contextBudget',
      'settings.nav.preferences',
      'titlebar.closeWindow',
    ]) {
      expect(usedKeys).toContain(key);
    }
  });

  it.each(LOCALES)('resolves every used key in %s without English fallback', async (lng) => {
    const instance = await translator(lng);
    for (const key of [...usedKeys, ...DYNAMIC_KEYS]) {
      // A plural base is covered when at least its `other` form exists.
      const probe = resourceValue(lng, key) !== undefined ? key : `${key}_other`;
      expect(typeof resourceValue(lng, probe), `${lng}:${key}`).toBe('string');
      expect(instance.exists(probe), `${lng}:${key}`).toBe(true);
      expect(instance.t(probe, { count: 5, name: 'x', formatted: '5' }), `${lng}:${key}`).not.toBe(
        probe,
      );
    }
  });

  it('keeps interpolation placeholders consistent per plural base across locales', () => {
    const leaves: Record<string, Record<Lang, string[]>> = {};
    for (const lng of LOCALES) {
      const walk = (node: unknown, prefix: string) => {
        if (typeof node === 'string') {
          const base = baseKey(prefix);
          leaves[base] ??= { en: [], ar: [], 'zh-CN': [], ru: [] };
          leaves[base][lng] = [...new Set([...leaves[base][lng], ...placeholders(node)])].sort();
        } else if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
        }
      };
      walk(defaultResources[lng].translation, '');
    }
    for (const [base, perLocale] of Object.entries(leaves)) {
      expect(perLocale.ar, base).toEqual(perLocale.en);
      expect(perLocale['zh-CN'], base).toEqual(perLocale.en);
      expect(perLocale.ru, base).toEqual(perLocale.en);
    }
  });

  it('resolves plural forms without leaking keys', async () => {
    const counts = [0, 1, 2, 3, 5, 11, 100, 100000];
    const bases = [
      'compose.tokensUsed',
      'settings.budget.tokensAllowed',
      'settings.routing.fallbackModels',
      'settings.routing.seconds',
      'compose.withheldAttachments',
      'compose.charsCompact',
    ];
    for (const lng of LOCALES) {
      const instance = await translator(lng);
      for (const base of bases) {
        for (const count of counts) {
          const value = instance.t(base, {
            count,
            formatted: String(count),
            used: '1',
            total: '2',
            percent: 50,
            firstLine: 'x',
          });
          expect(value, `${lng}:${base}#${count}`).not.toContain(base);
          expect(value.trim(), `${lng}:${base}#${count}`).not.toBe('');
        }
      }
    }
  });

  it('renders exact plural grammar spot checks', async () => {
    const en = await translator('en');
    expect(en.t('settings.routing.seconds', { count: 1 })).toBe('1 second');
    expect(en.t('settings.routing.seconds', { count: 30 })).toBe('30 seconds');
    expect(en.t('compose.tokensUsed', { count: 1, used: '1', total: '1', percent: 0 })).toContain(
      '1 token ',
    );
    const ar = await translator('ar');
    expect(ar.t('settings.routing.seconds', { count: 2 })).toBe('ثانيتان');
    expect(ar.t('settings.routing.fallbackModels', { count: 3 })).toContain('نماذج');
    const ru = await translator('ru');
    expect(ru.t('settings.routing.seconds', { count: 5 })).toContain('секунд');
    expect(ru.t('compose.tokensUsed', { count: 2, used: '1', total: '2', percent: 0 })).toContain(
      'токена',
    );
  });

  it('persists selection and restores it with document lang/dir', async () => {
    const { LANGUAGE_STORAGE_KEY } = await import('../../theme/theme-context');
    window.localStorage.clear();
    const before = document.documentElement.lang;
    try {
      await i18n.changeLanguage('ar');
      expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      await i18n.changeLanguage('en');
      expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    } finally {
      await i18n.changeLanguage('en');
      window.localStorage.clear();
      document.documentElement.lang = before;
    }
  });
});
