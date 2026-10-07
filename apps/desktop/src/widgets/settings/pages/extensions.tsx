import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function ExtensionsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.extensions.title')}
        </h3>
        <p className="text-xs text-foreground-secondary">{t('settings.extensions.desc')}</p>
      </div>

      {/* Plugins */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('settings.extensions.plugins')}
          </div>
          <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
            Active
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          Isolated plugin host and signed manifest verification engine active.
        </p>
      </div>

      {/* MCP */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('settings.extensions.mcp')}
          </div>
          <span className="rounded bg-selection px-2 py-0.5 text-xs text-action font-medium">
            Governed
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          Model Context Protocol: Tools require explicit policy grants per project.
        </p>
      </div>
    </div>
  );
}
