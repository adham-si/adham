import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('settings.privacy.title')}</h3>
        <p className="text-xs text-foreground-secondary">{t('settings.privacy.desc')}</p>
      </div>

      {/* Sandbox Isolation */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('settings.privacy.sandbox')}
          </div>
          <span className="rounded bg-selection px-2 py-0.5 text-xs text-action font-medium">
            Strict Enforcement
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          Threat model P0-05 active: Tools execute in bounded staging directories without ambient
          host credentials.
        </p>
      </div>

      {/* Telemetry Off by Default */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('settings.privacy.telemetry')}
          </div>
          <span className="rounded bg-surface px-2 py-0.5 text-xs text-foreground-muted font-medium border border-border-subtle">
            Disabled
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">{t('settings.privacy.telemetryDesc')}</p>
      </div>
    </div>
  );
}
