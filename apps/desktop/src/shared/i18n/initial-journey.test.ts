import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import i18n, { defaultResources } from './index';

// Inventory the existing journey without changing its components or hooks.
// Runtime errors/warnings that bypass t() require separate owner coordination.
const journeyFiles = [
  '../../features/workspace-selection/workspace-selection.tsx',
  '../../features/conversation/provisioning-form.tsx',
  '../../features/conversation/conversation-setup-slot.tsx',
  '../../features/conversation/conversation-panel.tsx',
  '../../widgets/shell/primary-sidebar/primary-sidebar.tsx',
  '../../widgets/compose/composer.tsx',
  '../../widgets/compose/compose-input.tsx',
  '../../widgets/compose/compose-action-bar.tsx',
  '../../widgets/compose/compose-mode-selector.tsx',
  '../../widgets/compose/compose-model-picker.tsx',
  '../../features/conversation/attachments/ui/attachment-picker.tsx',
  '../../widgets/compose/compose-approval-bar.tsx',
  '../../widgets/compose/compose-status-strip.tsx',
];

function collectJourneyKeys() {
  const keys = new Set<string>();
  for (const file of journeyFiles) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const source = readFileSync(path, 'utf8');
    // Static single-quoted t() keys and mode labelKey fields follow the
    // existing journey convention. Hardcoded text is intentionally excluded.
    for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
      if (match[1]) keys.add(match[1]);
    }
    for (const match of source.matchAll(/\blabelKey:\s*'([^']+)'/g)) {
      if (match[1]) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

const journeyKeys = collectJourneyKeys();

function resourceValue(language: 'en' | 'ar', key: string): unknown {
  let value: unknown = defaultResources[language].translation;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

// Plural bases (e.g. settings.routing.fallbackModels) have only suffixed leaves;
// probe the `other` form for those.
function probeValue(language: 'en' | 'ar', key: string): unknown {
  const direct = resourceValue(language, key);
  if (typeof direct === 'string') return direct;
  return resourceValue(language, `${key}_other`);
}

function placeholders(value: string) {
  return [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1]).sort();
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

describe('initial journey English / Arabic localization', () => {
  it('keeps the reported sidebar keys in the audited inventory', () => {
    expect(journeyKeys).toContain('compose.newSession');
    expect(journeyKeys).toContain('compose.emptyHistory');
    expect(journeyKeys).toContain('firstProjectIn');
    expect(journeyKeys).toContain('conversation.executionUnavailable');
  });

  it.each(['en', 'ar'] as const)(
    'resolves every audited key in %s without fallback',
    async (lng) => {
      const instance = await translator(lng);
      for (const key of journeyKeys) {
        const value = probeValue(lng, key);
        expect(typeof value, `${lng}:${key}`).toBe('string');
        expect(String(value).trim(), `${lng}:${key}`).not.toBe('');
        expect(instance.exists(key, { count: 5 }), `${lng}:${key}`).toBe(true);
        expect(
          instance.t(key, {
            count: 5,
            name: 'Synthetic project',
            formatted: '5',
            firstLine: 'x',
            used: '1',
            total: '2',
            percent: 50,
          }),
          `${lng}:${key}`,
        ).not.toBe(key);
      }
    },
  );

  it.each([
    ['en', 'New Session', 'No sessions yet'],
    ['ar', 'جلسة جديدة', 'لا توجد جلسات بعد'],
  ])('resolves the reported sidebar labels in %s', async (lng, newSession, emptyHistory) => {
    const instance = await translator(lng);
    expect(instance.t('compose.newSession')).toBe(newSession);
    expect(instance.t('compose.emptyHistory')).toBe(emptyHistory);
  });

  it('preserves interpolation placeholders in every audited translation', () => {
    for (const key of journeyKeys) {
      expect(typeof probeValue('en', key), key).toBe('string');
      expect(typeof probeValue('ar', key), key).toBe('string');
      expect(placeholders(String(probeValue('ar', key))), key).toEqual(
        placeholders(String(probeValue('en', key))),
      );
    }
    expect(placeholders(String(resourceValue('en', 'firstProjectIn')))).toEqual(['name']);
  });

  it.each(['en', 'ar'])('interpolates the synthetic workspace name in %s', async (lng) => {
    const instance = await translator(lng);
    const value = instance.t('firstProjectIn', { name: 'Synthetic workspace' });
    expect(value).toContain('Synthetic workspace');
    expect(value).not.toContain('{{');
  });

  it('retains the existing namespace, English fallback and Arabic regional resolution', async () => {
    expect([i18n.options.defaultNS].flat()).toEqual(['translation']);
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
    const fallback = await translator('fr', 'en');
    expect(fallback.t('compose.newSession')).toBe('New Session');
    expect(fallback.t('translation:compose.newSession')).toBe('New Session');
    expect(fallback.t('missing:compose.newSession')).toBe('compose.newSession');
    expect(fallback.t('journeyMissingKey', { defaultValue: 'Existing fallback' })).toBe(
      'Existing fallback',
    );
    const arabic = await translator('ar-MA', 'en');
    expect(arabic.t('compose.newSession')).toBe('جلسة جديدة');
  });
});
