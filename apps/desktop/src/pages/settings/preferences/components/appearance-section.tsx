import { useTranslation } from 'react-i18next';
import { useAppPreferences } from '@/shared/settings/use-app-preferences';

export function AppearanceSection() {
  const { t } = useTranslation();
  const { preferences, isSaving, update } = useAppPreferences();

  return (
    <section aria-labelledby="appearance-section-heading" className="space-y-4">
      {/* Section Header with Notion-style separator line */}
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="appearance-section-heading" className="text-sm font-semibold text-foreground">
          {t('settings.preferences.appearanceTitle', 'Appearance')}
        </h3>
      </div>

      <div className="space-y-4">
        {/* Theme Row */}
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor="appearance-theme-select"
              className="text-sm font-medium text-foreground"
            >
              {t('settings.preferences.themeLabel', 'Theme')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.themeHint',
                'Switch between light and dark modes, or sync with your operating system.',
              )}
            </div>
          </div>
          <select
            id="appearance-theme-select"
            value={preferences.appearance}
            disabled={isSaving}
            onChange={(e) =>
              void update({ appearance: e.target.value as 'light' | 'dark' | 'system' })
            }
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="system">{t('common.systemDefault', 'System default')}</option>
            <option value="light">{t('settings.preferences.light', 'Light')}</option>
            <option value="dark">{t('settings.preferences.dark', 'Dark')}</option>
          </select>
        </div>

        {/* High Contrast Row */}
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor="appearance-contrast-select"
              className="text-sm font-medium text-foreground"
            >
              {t('settings.preferences.highContrastLabel', 'High contrast')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.highContrastHint',
                'Enhance contrast across borders, text, and surfaces for improved readability.',
              )}
            </div>
          </div>
          <select
            id="appearance-contrast-select"
            value={preferences.highContrast}
            disabled={isSaving}
            onChange={(e) =>
              void update({
                highContrast: e.target.value as 'system' | 'enabled' | 'disabled',
              })
            }
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="system">{t('common.systemDefault', 'System default')}</option>
            <option value="enabled">{t('common.enabled', 'Enabled')}</option>
            <option value="disabled">{t('common.disabled', 'Disabled')}</option>
          </select>
        </div>

        {/* Reduced Motion Row */}
        <div className="flex items-center justify-between">
          <div>
            <label
              htmlFor="appearance-motion-select"
              className="text-sm font-medium text-foreground"
            >
              {t('settings.preferences.reducedMotionLabel', 'Reduced motion')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.reducedMotionHint',
                'Minimize interface animations, or follow your operating system setting.',
              )}
            </div>
          </div>
          <select
            id="appearance-motion-select"
            value={preferences.reducedMotion}
            disabled={isSaving}
            onChange={(e) =>
              void update({
                reducedMotion: e.target.value as 'system' | 'reduce' | 'no-preference',
              })
            }
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="system">{t('common.systemDefault', 'System default')}</option>
            <option value="reduce">{t('settings.preferences.motionReduce', 'Reduce')}</option>
            <option value="no-preference">
              {t('settings.preferences.motionNoPreference', 'No preference')}
            </option>
          </select>
        </div>

        {/* Font Family Selection Row */}
        <div className="flex items-center justify-between">
          <div>
            <label htmlFor="appearance-font-select" className="text-sm font-medium text-foreground">
              {t('settings.preferences.fontFamilyLabel', 'Font family')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.fontFamilyHint',
                'Choose the primary typography typeface for the interface.',
              )}
            </div>
          </div>
          <select
            id="appearance-font-select"
            value={preferences.fontFamily}
            disabled={isSaving}
            onChange={(e) =>
              void update({
                fontFamily: e.target.value as 'default' | 'system' | 'serif' | 'mono',
              })
            }
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="default">
              {t('settings.preferences.fontDefaultInter', 'Default (Inter)')}
            </option>
            <option value="system">{t('settings.preferences.fontSystemUi', 'System UI')}</option>
            <option value="serif">{t('settings.preferences.fontSerif', 'Serif')}</option>
            <option value="mono">{t('settings.preferences.fontMonospace', 'Monospace')}</option>
          </select>
        </div>

        {/* Font Size Control Row */}
        <div className="flex items-center justify-between">
          <div>
            <label htmlFor="appearance-size-select" className="text-sm font-medium text-foreground">
              {t('settings.preferences.fontSizeLabel', 'Font size')}
            </label>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.preferences.fontSizeHint',
                'Adjust the baseline text scale across workspace dialogs and views.',
              )}
            </div>
          </div>
          <select
            id="appearance-size-select"
            value={preferences.fontSize}
            disabled={isSaving}
            onChange={(e) => void update({ fontSize: e.target.value as 'sm' | 'md' | 'lg' })}
            className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="sm">{t('common.small', 'Small')}</option>
            <option value="md">
              {t('settings.preferences.mediumDefault', 'Medium (default)')}
            </option>
            <option value="lg">{t('common.large', 'Large')}</option>
          </select>
        </div>
      </div>
    </section>
  );
}
