import { useTranslation } from 'react-i18next';
import * as React from 'react';
import { AppearanceSection, LanguageSection, EditorSection } from './components';
import { useAppPreferences } from '@/shared/settings/use-app-preferences';

export function PreferencesPage() {
  const { t } = useTranslation();
  const { syncState, saveError, retrySync, isSaving, resetToDefaults } = useAppPreferences();
  const [confirmingReset, setConfirmingReset] = React.useState(false);
  const [resetDone, setResetDone] = React.useState(false);

  // A stale success note must not survive the next save.
  React.useEffect(() => {
    if (isSaving) setResetDone(false);
  }, [isSaving]);

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

      {/* Reset to Defaults Section */}
      <section aria-labelledby="reset-section-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="reset-section-heading" className="text-sm font-semibold text-foreground">
            {t('settings.preferences.resetTitle', 'Reset to defaults')}
          </h3>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.preferences.resetTitle', 'Reset to defaults')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.resetHint',
                'Restore installation defaults for theme, language and input. This does not delete workspaces, conversations, credentials or app data.',
              )}
            </div>
            {resetDone && syncState === 'synced' && (
              <div role="status" className="text-xs text-success font-medium mt-1">
                {t('settings.preferences.resetDone', 'Defaults restored.')}
              </div>
            )}
          </div>
          {confirmingReset ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                disabled={isSaving}
                className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setConfirmingReset(false);
                  void resetToDefaults().then((confirmed) => {
                    if (confirmed) setResetDone(true);
                  });
                }}
                className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
              >
                {isSaving
                  ? t('settings.preferences.syncSaving', 'Saving…')
                  : t('settings.preferences.resetConfirm', 'Confirm reset')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                setResetDone(false);
                setConfirmingReset(true);
              }}
              className="shrink-0 min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
            >
              {t('settings.preferences.resetButton', 'Reset to defaults')}
            </button>
          )}
        </div>
      </section>
      {/*
        The desktop-integration section is intentionally gone: its only
        control (workspace-link handling) had no consumer, so it was a
        placebo. Links open in the system browser via the WebView default.
      */}
    </div>
  );
}
