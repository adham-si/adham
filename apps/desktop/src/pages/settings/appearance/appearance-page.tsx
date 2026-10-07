import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { useTheme } from '@/theme/use-theme';

export function AppearancePage() {
  const { t, i18n } = useTranslation();
  const { appearance, setAppearance } = useTheme();

  const themes: Array<{ id: 'light' | 'dark' | 'system'; label: string }> = [
    { id: 'light', label: t('settings.appearance.light') },
    { id: 'dark', label: t('settings.appearance.dark') },
    { id: 'system', label: t('settings.appearance.system') },
  ];

  const languages = [
    { code: 'en', name: 'English', dir: 'ltr' },
    { code: 'ar', name: 'العربية', dir: 'rtl' },
    { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
    { code: 'ru', name: 'Русский', dir: 'ltr' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.appearance.title')}
        </h3>
        <p className="text-xs text-foreground-secondary">{t('settings.appearance.desc')}</p>
      </div>

      {/* Theme Selection */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          {t('settings.appearance.theme')}
        </label>
        <div className="flex gap-2">
          {themes.map((th) => {
            const isSelected = appearance === th.id;
            return (
              <Button
                key={th.id}
                size="sm"
                variant={isSelected ? 'primary' : 'secondary'}
                onClick={() => setAppearance(th.id)}
              >
                {th.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Language Selection */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          {t('settings.appearance.language')}
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {languages.map((lang) => {
            const isSelected = i18n.language.startsWith(lang.code);
            return (
              <Button
                key={lang.code}
                size="sm"
                variant={isSelected ? 'primary' : 'secondary'}
                onClick={() => i18n.changeLanguage(lang.code)}
                className="justify-center"
              >
                {lang.name}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Accessibility / High Contrast note */}
      <div className="rounded-md border border-border-subtle bg-surface p-3 text-xs text-foreground-secondary">
        <span className="font-semibold text-foreground">High Contrast & Scaling: </span>
        <span>
          Windows High Contrast Canvas colors and 200% font scaling are actively verified.
        </span>
      </div>
    </div>
  );
}
