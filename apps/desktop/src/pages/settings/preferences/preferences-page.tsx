import { useTranslation } from 'react-i18next';
import { AppearanceSection, LanguageSection, EditorSection } from './components';
import { useAppPreferences } from '@/shared/settings/use-app-preferences';

export function PreferencesPage() {
  const { t } = useTranslation();
  const { syncState, saveError, retrySync } = useAppPreferences();

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.preferences.pageTitle', 'Preferences')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.preferences.pageDesc',
            'Customize your workspace theme, language, and interface layout.',
          )}
        </p>
        {syncState !== 'synced' && (
          <div className="mt-1 flex items-center gap-2">
            <p
              role={syncState === 'error' ? 'alert' : 'status'}
              className="text-xs text-foreground-secondary"
            >
              {syncState === 'saving' && t('settings.preferences.syncSaving', 'Saving…')}
              {syncState === 'unsynced' &&
                t(
                  'settings.preferences.syncUnsynced',
                  'Settings storage is unreachable — changes apply to this session only.',
                )}
              {syncState === 'error' &&
                saveError?.kind === 'validation' &&
                t(
                  'settings.preferences.syncInvalid',
                  'That value is not supported — nothing was saved.',
                )}
              {syncState === 'error' &&
                saveError?.kind === 'conflict' &&
                t(
                  'settings.preferences.syncConflict',
                  'Settings changed elsewhere — reloaded the latest values.',
                )}
              {syncState === 'error' &&
                saveError &&
                saveError.kind !== 'validation' &&
                saveError.kind !== 'conflict' &&
                t('settings.preferences.syncNotSaved', 'Could not save settings. Try again.')}
            </p>
            {(syncState === 'error' || syncState === 'unsynced') && (
              <button
                type="button"
                onClick={() => void retrySync()}
                className="shrink-0 rounded-md border border-border-subtle bg-surface px-2 py-0.5 text-xs text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
              >
                {t('settings.preferences.syncRetry', 'Retry')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Domain Sections */}
      <AppearanceSection />
      <LanguageSection />
      <EditorSection />
      {/*
        The desktop-integration section is intentionally gone: its only
        control (workspace-link handling) had no consumer, so it was a
        placebo. Links open in the system browser via the WebView default.
      */}
    </div>
  );
}
