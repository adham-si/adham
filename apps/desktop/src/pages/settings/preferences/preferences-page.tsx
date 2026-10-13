import { useTranslation } from 'react-i18next';
import { AppearanceSection, LanguageSection, EditorSection, DesktopSection } from './components';

export function PreferencesPage() {
  const { t } = useTranslation();
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
      </div>

      {/* Domain Sections */}
      <AppearanceSection />
      <LanguageSection />
      <EditorSection />
      <DesktopSection />
    </div>
  );
}
