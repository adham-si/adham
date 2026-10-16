import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adhamClient, DEFAULT_PREFERENCES } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { AppPreferencesSchema, type ValidatedAppPreferences } from '@/shared/api/schemas';
import { normalizeLanguage } from '@/shared/i18n';
import { useTheme } from '@/theme/use-theme';
import {
  applyPresentation,
  envelopeCode,
  loadSnapshot,
  migrateLegacy,
  mirrorPresentationCache,
  readPresentationCache,
  savePatch,
  SavePreferencesError,
  type PreferenceSnapshot,
} from './preferences-store';

export type PreferencesSyncState = 'synced' | 'saving' | 'unsynced' | 'error';

export interface AppPreferencesApi {
  preferences: ValidatedAppPreferences;
  revision: number;
  backendAvailable: boolean;
  syncState: PreferencesSyncState;
  saveError: SavePreferencesError | null;
  isSaving: boolean;
  update: (patch: Partial<ValidatedAppPreferences>) => Promise<void>;
  /** Clears the error state and re-reads the backend snapshot. */
  retrySync: () => Promise<void>;
  /**
   * Restores installation defaults through the reset contract. Applies the
   * confirmed defaults immediately; touches only presentation preferences —
   * never workspaces, conversations, credentials or app data. Resolves true
   * when the defaults were confirmed, false when nothing was applied.
   */
  resetToDefaults: () => Promise<boolean>;
}

function cacheSnapshot(): PreferenceSnapshot {
  return { preferences: readPresentationCache(), revision: 0, backendAvailable: false };
}

// Process-wide first-launch detection guard: several hook instances can be
// mounted at once (PreferencesHost + route), and each would otherwise persist
// the detected language against base revision 0. The first instance wins;
// the rest observe the updated snapshot.
let detectionPersisted = false;

// Shared process-wide save FIFO (see update below).
let saveTail: Promise<void> = Promise.resolve();

// Shared save/error state across mounted instances.
//
// Controls (AppearanceSection, …) and the page note (PreferencesPage) each
// mount their own useAppPreferences. Ordering flows through the module FIFO
// above; error and in-flight state must be shared too, or a failed save from
// a control would never reach the page note. Plain module cell with a
// listener set (read via useSyncExternalStore) keeps every instance in
// agreement without a provider.
interface SaveSyncSnapshot {
  saveError: SavePreferencesError | null;
  isSaving: boolean;
  localOnly: boolean;
}

let saveSyncSnapshot: SaveSyncSnapshot = { saveError: null, isSaving: false, localOnly: false };
const saveSyncListeners = new Set<() => void>();

function setSaveSyncSnapshot(next: SaveSyncSnapshot): void {
  saveSyncSnapshot = next;
  for (const listener of saveSyncListeners) listener();
}

function subscribeSaveSync(listener: () => void): () => void {
  saveSyncListeners.add(listener);
  return () => {
    saveSyncListeners.delete(listener);
  };
}

function getSaveSyncSnapshot(): SaveSyncSnapshot {
  return saveSyncSnapshot;
}

export function useSharedSaveState(): SaveSyncSnapshot {
  return React.useSyncExternalStore(subscribeSaveSync, getSaveSyncSnapshot);
}

/** Test-only reset for module sync state (outlives a test file). */
export function resetPreferencesSyncForTests(): void {
  detectionPersisted = false;
  setSaveSyncSnapshot({ saveError: null, isSaving: false, localOnly: false });
}

/**
 * Backend-authoritative application preferences.
 *
 * The backend snapshot wins over the presentation cache on load (and drives
 * theme, language, fonts, contrast and motion onto the document); every
 * control writes through `update`, which confirms with the backend before
 * applying. When no backend is reachable at all (e.g. browser dev without
 * Tauri), values apply session-locally and are honestly flagged `unsynced`
 * instead of reported as saved.
 */
export function useAppPreferences(): AppPreferencesApi {
  const queryClient = useQueryClient();
  const { setAppearance } = useTheme();
  const { i18n } = useTranslation();
  const { saveError, isSaving, localOnly } = useSharedSaveState();

  const query = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: async (): Promise<PreferenceSnapshot> =>
      migrateLegacy(adhamClient, await loadSnapshot(adhamClient)),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const snapshot: PreferenceSnapshot = query.data ?? cacheSnapshot();

  const update = React.useCallback(
    (patch: Partial<ValidatedAppPreferences>): Promise<void> => {
      setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), saveError: null });
      // Shared process-wide FIFO: every mounted instance serializes through
      // one tail, so concurrent updates observe each other's revisions
      // instead of racing on the same base. The tail can never poison: the
      // work catches everything, and waiters attach on both outcomes.
      const work = async (): Promise<void> => {
        const current =
          queryClient.getQueryData<PreferenceSnapshot>(queryKeys.preferences) ?? cacheSnapshot();
        if (!current.backendAvailable) {
          const merged = AppPreferencesSchema.parse({ ...current.preferences, ...patch });
          applyPresentation(merged);
          mirrorPresentationCache(merged);
          queryClient.setQueryData<PreferenceSnapshot>(queryKeys.preferences, {
            preferences: merged,
            revision: 0,
            backendAvailable: false,
          });
          setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), localOnly: true });
          return;
        }
        setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), isSaving: true });
        try {
          const next = await savePatch(adhamClient, current, patch);
          applyPresentation(next.preferences);
          mirrorPresentationCache(next.preferences);
          queryClient.setQueryData<PreferenceSnapshot>(queryKeys.preferences, next);
          setSaveSyncSnapshot({ saveError: null, isSaving: false, localOnly: false });
        } catch (error) {
          setSaveSyncSnapshot({
            saveError:
              error instanceof SavePreferencesError
                ? error
                : new SavePreferencesError('unknown', 'Could not save settings.'),
            isSaving: false,
            localOnly: getSaveSyncSnapshot().localOnly,
          });
        }
      };
      const run = saveTail.then(work, work);
      saveTail = run;
      return run;
    },
    [queryClient],
  );

  // Authority application: backend snapshot drives the document, the theme
  // context and the i18n language. Idempotent — re-running with the same
  // snapshot is a no-op (same-value sets, guarded language switch).
  // First-launch exception: a pristine backend (revision 0) carries no user
  // choice, so it must not override OS language detection (P0 1.6). Instead
  // the detected language is persisted once, making detection durable.
  React.useEffect(() => {
    if (!query.data) return;
    applyPresentation(query.data.preferences);
    // Authoritative-load cache refresh: re-mirror confirmed values so a
    // cleared cache recovers and the next offline startup reads the last
    // backend state instead of defaults. Write-through only — the cache
    // never flows back into the backend except via migration/update.
    if (query.data.backendAvailable) mirrorPresentationCache(query.data.preferences);
    setAppearance(query.data.preferences.appearance);
    const snapshotLang = query.data.preferences.language;
    const currentLang = normalizeLanguage(i18n.language);
    if (currentLang === snapshotLang) return;
    if (query.data.backendAvailable && query.data.revision === 0 && !detectionPersisted) {
      detectionPersisted = true;
      void update({ language: currentLang });
      return;
    }
    if (query.data.revision > 0) {
      void i18n.changeLanguage(snapshotLang);
    }
  }, [query.data, setAppearance, i18n, update]);

  const syncState: PreferencesSyncState = isSaving
    ? 'saving'
    : saveError
      ? 'error'
      : localOnly || !snapshot.backendAvailable
        ? 'unsynced'
        : 'synced';

  const resetToDefaults = React.useCallback(async (): Promise<boolean> => {
    setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), saveError: null });
    const work = async (): Promise<boolean> => {
      const current =
        queryClient.getQueryData<PreferenceSnapshot>(queryKeys.preferences) ?? cacheSnapshot();
      if (!current.backendAvailable) {
        const prefs = AppPreferencesSchema.parse({ ...DEFAULT_PREFERENCES });
        applyPresentation(prefs);
        mirrorPresentationCache(prefs);
        queryClient.setQueryData<PreferenceSnapshot>(queryKeys.preferences, {
          preferences: prefs,
          revision: 0,
          backendAvailable: false,
        });
        setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), localOnly: true });
        return true;
      }
      setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), isSaving: true });
      try {
        const res = await adhamClient.resetAppPreferences();
        const prefs = AppPreferencesSchema.parse(res.preferences);
        applyPresentation(prefs);
        mirrorPresentationCache(prefs);
        queryClient.setQueryData<PreferenceSnapshot>(queryKeys.preferences, {
          preferences: prefs,
          revision: res.revision,
          backendAvailable: true,
        });
        setSaveSyncSnapshot({ saveError: null, isSaving: false, localOnly: false });
        return true;
      } catch (error) {
        // Transport failure is honest offline; a backend rejection surfaces
        // generically — either way nothing is applied and the old values stay.
        const kind = envelopeCode(error) === null ? 'offline' : 'unknown';
        setSaveSyncSnapshot({
          saveError: new SavePreferencesError(kind, 'Could not reset settings.'),
          isSaving: false,
          localOnly: getSaveSyncSnapshot().localOnly,
        });
        return false;
      }
    };
    const run = saveTail.then(work, work);
    // The shared tail stays void-typed; only this call observes the outcome.
    saveTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, [queryClient]);

  const retrySync = React.useCallback(async (): Promise<void> => {
    setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), saveError: null });
    // Explicit refetch bypasses the infinite staleTime: this is the user's
    // deliberate retry, not a background refresh.
    await queryClient.refetchQueries({ queryKey: queryKeys.preferences });
    const fresh = queryClient.getQueryData<PreferenceSnapshot>(queryKeys.preferences);
    // A recovered backend reasserts authority; a still-dead one keeps the
    // local-only flag so values stay honestly labeled.
    if (fresh?.backendAvailable) {
      setSaveSyncSnapshot({ ...getSaveSyncSnapshot(), localOnly: false });
    }
  }, [queryClient]);

  return {
    preferences: snapshot.preferences,
    revision: snapshot.revision,
    backendAvailable: snapshot.backendAvailable,
    syncState,
    saveError,
    isSaving,
    update,
    retrySync,
    resetToDefaults,
  };
}

/** Mount once inside ThemeProvider: runs the authority-application effect. */
export function PreferencesHost() {
  useAppPreferences();
  return null;
}
