import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '@/shared/i18n';
import { useAppPreferences } from '@/shared/settings/use-app-preferences';

export function LanguageSection() {
  // Language application (including RTL) is owned by the preferences sync:
  // the control only records the choice; the backend confirms it first.
  const { t } = useTranslation();
  const { preferences, isSaving, update } = useAppPreferences();

  return (
    <section aria-labelledby="language-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="language-section-heading" className="text-sm font-semibold text-foreground">
          {t('settings.preferences.languageTitle', 'Language & region')}
        </h3>
      </div>

      <div className="space-y-4">
        {/* Language Row */}
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor="display-language-select"
              className="text-sm font-medium text-foreground"
            >
              {t('settings.preferences.displayLanguage', 'Display language')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.displayLanguageHint',
                'Choose the primary language used for workspace menus, dialogs, and messages.',
              )}
            </div>
          </div>
          <select
            id="display-language-select"
            value={normalizeLanguage(preferences.language)}
            disabled={isSaving}
            onChange={(e) => void update({ language: normalizeLanguage(e.target.value) })}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            {Object.values(SUPPORTED_LANGUAGES).map((language) => (
              <option key={language.code} value={language.code}>
                {language.nativeName}
              </option>
            ))}
          </select>
        </div>

        {/*
          The previous "Bidirectional text controls" switch is intentionally
          gone: it was local visual-only state with no effect on rendering.
          Text direction follows the selected language (RTL for Arabic) via
          document dir/lang sync in shared/i18n; per-message direction is
          handled at the presentation boundary, not by a global toggle.
        */}
      </div>
    </section>
  );
}
