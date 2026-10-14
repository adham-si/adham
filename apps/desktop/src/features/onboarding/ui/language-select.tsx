import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '@/shared/i18n';

/**
 * Compact display-language selector for the ready step. Full language
 * preferences stay in Settings; this only switches the running UI language.
 */
export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <span className="font-medium">{t('onboarding.languageLabel', 'Language')}</span>
      <select
        value={normalizeLanguage(i18n.language)}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
      >
        {Object.values(SUPPORTED_LANGUAGES).map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
