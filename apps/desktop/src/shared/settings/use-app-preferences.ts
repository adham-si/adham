import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adhamClient, type AppPreferences } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { AppPreferencesSchema } from '@/shared/api/schemas';
import { normalizeLanguage } from '@/shared/i18n';
import { useTheme } from '@/theme/use-theme';
import {
  applyPresentation,
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
  preferences: AppPreferences;
  revision: number;
  backendAvailable: boolean;
  syncState: PreferencesSyncState;
  saveError: SavePreferencesError | null;
  isSaving: boolean;
  update: (patch: Partial<AppPreferences>) => Promise<void>;
}

function cacheSnapshot(): PreferenceSnapshot {
  return { preferences: readPresentationCache(), revision: 0, backendAvailable: false };
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
  const [saveError, setSaveError] = React.useState<SavePreferencesError | null>(null);
  const [localOnly, setLocalOnly] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const tailRef = React.useRef(Promise.resolve());

  const query = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: async (): Promise<PreferenceSnapshot> =>
      migrateLegacy(adhamClient, await loadSnapshot(adhamClient)),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const snapshot: PreferenceSnapshot = query.data ?? cacheSnapshot();

  // Authority application: backend snapshot drives the document, the theme
  // context and the i18n language. Idempotent — re-running with the same
  // snapshot is a no-op (same-value sets, guarded language switch).
  React.useEffect(() => {
    if (!query.data) return;
    applyPresentation(query.data.preferences);
    setAppearance(query.data.preferences.appearance);
    if (normalizeLanguage(i18n.language) !== query.data.preferences.language) {
      void i18n.changeLanguage(query.data.preferences.language);
    }
  }, [query.data, setAppearance, i18n]);

  const update = React.useCallback(
    (patch: Partial<AppPreferences>): Promise<void> => {
      setSaveError(null);
      const run = tailRef.current.then(async () => {
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
          setLocalOnly(true);
          return;
        }
        setIsSaving(true);
        try {
          const next = await savePatch(adhamClient, current, patch);
          applyPresentation(next.preferences);
          mirrorPresentationCache(next.preferences);
          queryClient.setQueryData<PreferenceSnapshot>(queryKeys.preferences, next);
          setLocalOnly(false);
        } catch (error) {
          if (error instanceof SavePreferencesError) {
            setSaveError(error);
          } else {
            setSaveError(new SavePreferencesError('unknown', 'Could not save settings.'));
          }
        } finally {
          setIsSaving(false);
        }
      });
      tailRef.current = run;
      return run;
    },
    [queryClient],
  );

  const syncState: PreferencesSyncState = isSaving
    ? 'saving'
    : saveError
      ? 'error'
      : localOnly || !snapshot.backendAvailable
        ? 'unsynced'
        : 'synced';

  return {
    preferences: snapshot.preferences,
    revision: snapshot.revision,
    backendAvailable: snapshot.backendAvailable,
    syncState,
    saveError,
    isSaving,
    update,
  };
}

/** Mount once inside ThemeProvider: runs the authority-application effect. */
export function PreferencesHost() {
  useAppPreferences();
  return null;
}
