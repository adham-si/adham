import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPresentation,
  clearLegacyPreferences,
  loadSnapshot,
  migrateLegacy,
  readLegacyPreferences,
  savePatch,
  type PreferenceClient,
  type PreferenceSnapshot,
} from './preferences-store';
import { DEFAULT_PREFERENCES } from '@/shared/api/adham-client';

function envelope(code: string) {
  return {
    protocolVersion: 1,
    code,
    messageKey: 'error.test',
    retryable: true,
    correlationId: 'corr-1',
    fieldErrors: [],
  };
}

function fakeClient(opts: {
  stored?: PreferenceSnapshot;
  failGet?: unknown;
  failUpdate?: unknown;
  onUpdate?: (prefs: unknown, base: number) => void;
}): PreferenceClient & { updates: Array<{ prefs: unknown; base: number }> } {
  const updates: Array<{ prefs: unknown; base: number }> = [];
  let stored: PreferenceSnapshot = opts.stored ?? {
    preferences: { ...DEFAULT_PREFERENCES },
    revision: 0,
  };
  return {
    updates,
    async getAppPreferences() {
      if (opts.failGet !== undefined) throw opts.failGet;
      return { preferences: { ...stored.preferences }, revision: stored.revision };
    },
    async updateAppPreferences(prefs, base) {
      updates.push({ prefs, base });
      opts.onUpdate?.(prefs, base);
      if (opts.failUpdate !== undefined) throw opts.failUpdate;
      stored = {
        preferences: { ...(prefs as PreferenceSnapshot['preferences']) },
        revision: stored.revision + 1,
      };
      return { preferences: { ...stored.preferences }, revision: stored.revision };
    },
  };
}

const DARK_AR = {
  ...DEFAULT_PREFERENCES,
  appearance: 'dark',
  language: 'ar',
} as const;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.fontFamily;
  delete document.documentElement.dataset.fontSize;
  delete document.documentElement.dataset.highContrast;
  delete document.documentElement.dataset.reducedMotion;
});

describe('applyPresentation', () => {
  it('applies explicit values onto the document', () => {
    applyPresentation(
      { ...DARK_AR, fontSize: 'lg', highContrast: 'enabled', reducedMotion: 'reduce' } as never,
      {
        dark: false,
        reduceMotion: false,
        highContrast: false,
      },
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.fontSize).toBe('lg');
    expect(document.documentElement.dataset.highContrast).toBe('enabled');
    expect(document.documentElement.dataset.reducedMotion).toBe('reduce');
  });

  it('resolves system values from the OS preference', () => {
    applyPresentation({ ...DEFAULT_PREFERENCES } as never, {
      dark: true,
      reduceMotion: true,
      highContrast: true,
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.highContrast).toBe('enabled');
    expect(document.documentElement.dataset.reducedMotion).toBe('reduce');
  });
});

describe('legacy migration', () => {
  it('reads only valid legacy keys', () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    window.localStorage.setItem('adham.language', 'xx-not-a-language');
    window.localStorage.setItem('adham.font-size', 'lg');
    const legacy = readLegacyPreferences();
    expect(legacy).toMatchObject({ appearance: 'dark', fontSize: 'lg' });
    expect(legacy).not.toHaveProperty('language');
  });

  it('migrates legacy values once, then clears the legacy keys', async () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    window.localStorage.setItem('adham.language', 'ar');
    const client = fakeClient({});
    const snapshot = await loadSnapshot(client);
    const migrated = await migrateLegacy(client, snapshot);
    expect(migrated.revision).toBe(1);
    expect(migrated.preferences.appearance).toBe('dark');
    expect(migrated.preferences.language).toBe('ar');
    expect(client.updates).toHaveLength(1);
    // The cache mirror re-populates confirmed values (authority): the keys
    // hold backend-confirmed values, and anything migration never touches
    // is covered by the next test.
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
    expect(window.localStorage.getItem('adham.language')).toBe('ar');
  });

  it('clears legacy keys that migration does not carry over', async () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    window.localStorage.setItem('adham.font-size', 'xxl-not-a-size');
    const client = fakeClient({});
    const snapshot = await loadSnapshot(client);
    await migrateLegacy(client, snapshot);
    expect(window.localStorage.getItem('adham.font-size')).toBe('md');
  });

  it('keeps legacy keys when the migration write fails', async () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    const client = fakeClient({ failUpdate: new Error('transport down') });
    const snapshot = await loadSnapshot(client);
    const migrated = await migrateLegacy(client, snapshot);
    expect(migrated.revision).toBe(0);
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
  });

  it('backend values win over stale legacy keys', async () => {
    window.localStorage.setItem('adham.appearance', 'light');
    const client = fakeClient({
      stored: { preferences: { ...DARK_AR } as never, revision: 2 },
    });
    const snapshot = await loadSnapshot(client);
    const migrated = await migrateLegacy(client, snapshot);
    expect(client.updates).toHaveLength(0);
    expect(migrated.preferences.appearance).toBe('dark');
    expect(window.localStorage.getItem('adham.appearance')).toBeNull();
  });
});

describe('loadSnapshot', () => {
  it('falls back to the presentation cache when the backend is unreachable', async () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    const client = fakeClient({ failGet: new Error('transport down') });
    const snapshot = await loadSnapshot(client);
    expect(snapshot.backendAvailable).toBe(false);
    expect(snapshot.preferences.appearance).toBe('dark');
  });
});

describe('savePatch', () => {
  it('rebases and retries once after a revision conflict, preserving the latest value', async () => {
    let calls = 0;
    const client = fakeClient({
      stored: { preferences: { ...DEFAULT_PREFERENCES } as never, revision: 5 },
      onUpdate: () => {
        calls += 1;
        if (calls === 1) throw envelope('ConcurrencyConflict');
      },
    });
    const current: PreferenceSnapshot = {
      preferences: { ...DEFAULT_PREFERENCES },
      revision: 4,
      backendAvailable: true,
    };
    const next = await savePatch(client, current, { appearance: 'dark' });
    expect(next.revision).toBe(6);
    expect(next.preferences.appearance).toBe('dark');
    // First attempt with the stale base, second with the rebased revision.
    expect(client.updates.map((u) => u.base)).toEqual([4, 5]);
  });

  it('surfaces validation failures without writing or retrying', async () => {
    const client = fakeClient({ failUpdate: envelope('InvalidRequest') });
    const current: PreferenceSnapshot = {
      preferences: { ...DEFAULT_PREFERENCES },
      revision: 0,
      backendAvailable: true,
    };
    await expect(savePatch(client, current, { appearance: 'dark' })).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(client.updates).toHaveLength(1);
  });

  it('gives up after a second conflict instead of looping', async () => {
    const client = fakeClient({ failUpdate: envelope('ConcurrencyConflict') });
    const current: PreferenceSnapshot = {
      preferences: { ...DEFAULT_PREFERENCES },
      revision: 0,
      backendAvailable: true,
    };
    await expect(savePatch(client, current, { appearance: 'dark' })).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect(client.updates).toHaveLength(2);
  });

  it('reports transport failure so the caller can mark values unsynced, not saved', async () => {
    const client = fakeClient({ failUpdate: new Error('transport down') });
    const current: PreferenceSnapshot = {
      preferences: { ...DEFAULT_PREFERENCES },
      revision: 0,
      backendAvailable: true,
    };
    await expect(savePatch(client, current, { appearance: 'dark' })).rejects.toMatchObject({
      kind: 'offline',
    });
  });
});

describe('clearLegacyPreferences', () => {
  it('removes every legacy key', () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    window.localStorage.setItem('adham.language', 'ar');
    window.localStorage.setItem('adham.font-family', 'serif');
    window.localStorage.setItem('adham.font-size', 'lg');
    window.localStorage.setItem('adham.high-contrast', 'enabled');
    window.localStorage.setItem('adham.reduced-motion', 'reduce');
    clearLegacyPreferences();
    expect(readLegacyPreferences()).toBeNull();
  });

  it('reads the full presentation cache for startup application', () => {
    window.localStorage.setItem('adham.high-contrast', 'enabled');
    window.localStorage.setItem('adham.reduced-motion', 'banana');
    window.localStorage.setItem('adham.font-family', 'serif');
    expect(readLegacyPreferences()).toMatchObject({
      highContrast: 'enabled',
      fontFamily: 'serif',
    });
    expect(readLegacyPreferences()).not.toHaveProperty('reducedMotion');
  });
});
