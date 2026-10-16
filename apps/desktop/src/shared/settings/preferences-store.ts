import {
  DEFAULT_PREFERENCES,
  type AppPreferences,
  type GetPreferencesResponse,
} from '@/shared/api/adham-client';
import { AppPreferencesSchema, type ValidatedAppPreferences } from '@/shared/api/schemas';

/** Minimal client surface the store needs (the real `adhamClient` satisfies it). */
export interface PreferenceClient {
  getAppPreferences(): Promise<GetPreferencesResponse>;
  updateAppPreferences(
    preferences: AppPreferences,
    baseRevision: number,
  ): Promise<GetPreferencesResponse>;
}

export interface PreferenceSnapshot {
  preferences: ValidatedAppPreferences;
  revision: number;
  backendAvailable: boolean;
}

export type SaveErrorKind = 'validation' | 'conflict' | 'offline' | 'unknown';

export class SavePreferencesError extends Error {
  readonly kind: SaveErrorKind;
  constructor(kind: SaveErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const LEGACY_KEYS = [
  'adham.appearance',
  'adham.language',
  'adham.font-family',
  'adham.font-size',
  'adham.high-contrast',
  'adham.reduced-motion',
] as const;

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: in-memory state still drives the session.
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best effort: a stale cache key is harmless once the backend is authoritative.
  }
}

/** Valid legacy presentation values. Anything else stays untouched by migration. */
export function readLegacyPreferences(): Partial<ValidatedAppPreferences> | null {
  const appearance = readKey('adham.appearance');
  const language = readKey('adham.language');
  const fontFamily = readKey('adham.font-family');
  const fontSize = readKey('adham.font-size');
  const highContrast = readKey('adham.high-contrast');
  const reducedMotion = readKey('adham.reduced-motion');
  const partial: Partial<ValidatedAppPreferences> = {};
  if (appearance === 'light' || appearance === 'dark' || appearance === 'system') {
    partial.appearance = appearance;
  }
  if (language === 'en' || language === 'ar' || language === 'zh-CN' || language === 'ru') {
    partial.language = language;
  }
  if (
    fontFamily === 'default' ||
    fontFamily === 'system' ||
    fontFamily === 'serif' ||
    fontFamily === 'mono'
  ) {
    partial.fontFamily = fontFamily;
  }
  if (fontSize === 'sm' || fontSize === 'md' || fontSize === 'lg') {
    partial.fontSize = fontSize;
  }
  if (highContrast === 'system' || highContrast === 'enabled' || highContrast === 'disabled') {
    partial.highContrast = highContrast;
  }
  if (
    reducedMotion === 'system' ||
    reducedMotion === 'reduce' ||
    reducedMotion === 'no-preference'
  ) {
    partial.reducedMotion = reducedMotion;
  }
  return Object.keys(partial).length > 0 ? partial : null;
}

export function clearLegacyPreferences(): void {
  for (const key of LEGACY_KEYS) removeKey(key);
}

export interface SystemPreferences {
  dark: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
}

function systemPreferences(): SystemPreferences {
  if (typeof window.matchMedia !== 'function') {
    return { dark: false, reduceMotion: false, highContrast: false };
  }
  return {
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    highContrast: window.matchMedia('(prefers-contrast: more)').matches,
  };
}

/**
 * Applies presentation preferences onto the document. Runs at startup (from
 * cache, then again from the backend snapshot) and after every confirmed
 * write — never speculatively before the backend confirms, except in the
 * explicit offline fallback where the caller marks values unsynced.
 */
export function applyPresentation(
  prefs: ValidatedAppPreferences,
  system: SystemPreferences = systemPreferences(),
): void {
  const dark = prefs.appearance === 'system' ? system.dark : prefs.appearance === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.fontFamily = prefs.fontFamily;
  document.documentElement.dataset.fontSize = prefs.fontSize;
  document.documentElement.dataset.highContrast =
    prefs.highContrast === 'system'
      ? system.highContrast
        ? 'enabled'
        : 'disabled'
      : prefs.highContrast;
  document.documentElement.dataset.reducedMotion =
    prefs.reducedMotion === 'system'
      ? system.reduceMotion
        ? 'reduce'
        : 'no-preference'
      : prefs.reducedMotion;
}

/**
 * Mirrors confirmed backend values into the presentation cache (first-paint
 * script + pre-backend startup read). Written only after the backend
 * confirms; the cache never overwrites the backend.
 */
export function mirrorPresentationCache(prefs: ValidatedAppPreferences): void {
  writeKey('adham.appearance', prefs.appearance);
  writeKey('adham.language', prefs.language);
  writeKey('adham.font-family', prefs.fontFamily);
  writeKey('adham.font-size', prefs.fontSize);
  writeKey('adham.high-contrast', prefs.highContrast);
  writeKey('adham.reduced-motion', prefs.reducedMotion);
}

/** Synchronous presentation-cache read for startup application (pre-backend). */
export function readPresentationCache(): ValidatedAppPreferences {
  return AppPreferencesSchema.parse({ ...DEFAULT_PREFERENCES, ...readLegacyPreferences() });
}

function snapshotFromCache(): ValidatedAppPreferences {
  return readPresentationCache();
}

function envelopeCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Backend snapshot, or the presentation cache flagged unreachable. */
export async function loadSnapshot(client: PreferenceClient): Promise<PreferenceSnapshot> {
  try {
    const res = await client.getAppPreferences();
    const preferences = AppPreferencesSchema.parse(res.preferences);
    return { preferences, revision: res.revision, backendAvailable: true };
  } catch {
    // Transport failure or corrupt payload: present the cache, flagged.
    return { preferences: snapshotFromCache(), revision: 0, backendAvailable: false };
  }
}

/**
 * One-shot migration: valid legacy values move into an untouched backend
 * (revision 0) and the legacy keys are cleared only after the write
 * confirms. Backend values always win over stale legacy keys. Failures keep
 * the legacy keys so nothing is lost.
 */
export async function migrateLegacy(
  client: PreferenceClient,
  snapshot: PreferenceSnapshot,
): Promise<PreferenceSnapshot> {
  const legacy = readLegacyPreferences();
  if (!legacy) return snapshot;
  if (!snapshot.backendAvailable || snapshot.revision > 0) {
    // Plain load, not a migration: the keys already mirror confirmed backend
    // values (every confirmed write re-mirrors all of them), so they stay as
    // the first-paint and offline cache. Only a successful migration write
    // below clears them.
    return snapshot;
  }
  const merged: ValidatedAppPreferences = AppPreferencesSchema.parse({
    ...DEFAULT_PREFERENCES,
    ...legacy,
  });
  try {
    const res = await client.updateAppPreferences(merged, 0);
    const preferences = AppPreferencesSchema.parse(res.preferences);
    clearLegacyPreferences();
    mirrorPresentationCache(preferences);
    return { preferences, revision: res.revision, backendAvailable: true };
  } catch {
    return snapshot;
  }
}

/**
 * Writes a patch against the caller's base revision. A revision conflict
 * refetches and retries once with the fresh revision so rapid changes keep
 * the latest accepted value; anything else (validation, second conflict,
 * transport) throws without applying, so the UI can never show a false save.
 */
export async function savePatch(
  client: PreferenceClient,
  current: PreferenceSnapshot,
  patch: Partial<ValidatedAppPreferences>,
): Promise<PreferenceSnapshot> {
  const merged: ValidatedAppPreferences = AppPreferencesSchema.parse({
    ...current.preferences,
    ...patch,
  });
  try {
    const res = await client.updateAppPreferences(merged, current.revision);
    return {
      preferences: AppPreferencesSchema.parse(res.preferences),
      revision: res.revision,
      backendAvailable: true,
    };
  } catch (error) {
    const code = envelopeCode(error);
    if (code === 'InvalidRequest' || code === 'InvalidProtocolVersion') {
      throw new SavePreferencesError('validation', 'Invalid preference value rejected.');
    }
    if (code === 'ConcurrencyConflict') {
      const fresh = await client.getAppPreferences();
      const rebased: ValidatedAppPreferences = AppPreferencesSchema.parse({
        ...AppPreferencesSchema.parse(fresh.preferences),
        ...patch,
      });
      try {
        const res = await client.updateAppPreferences(rebased, fresh.revision);
        return {
          preferences: AppPreferencesSchema.parse(res.preferences),
          revision: res.revision,
          backendAvailable: true,
        };
      } catch (retryError) {
        if (envelopeCode(retryError) === 'ConcurrencyConflict') {
          throw new SavePreferencesError(
            'conflict',
            'Settings changed elsewhere. Reloaded the latest values.',
          );
        }
        if (envelopeCode(retryError) === null) {
          throw new SavePreferencesError('offline', 'Settings storage is unreachable.');
        }
        throw new SavePreferencesError('unknown', 'Could not save settings.');
      }
    }
    if (code !== null) {
      throw new SavePreferencesError('unknown', 'Could not save settings.');
    }
    throw new SavePreferencesError('offline', 'Settings storage is unreachable.');
  }
}
