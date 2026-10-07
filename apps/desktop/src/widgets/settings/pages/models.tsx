import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function ModelsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('settings.models.title')}</h3>
        <p className="text-xs text-foreground-secondary">{t('settings.models.desc')}</p>
      </div>

      {/* Primary Local Model */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
              {t('settings.models.provider')}
            </div>
            <div className="text-sm font-medium text-foreground">Ollama Local Engine</div>
          </div>
          <span className="flex items-center gap-1 rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
            <span className="size-1.5 rounded-full bg-success" />
            Connected
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-xs">
          <span className="text-foreground-secondary">Endpoint</span>
          <span className="font-mono text-foreground">http://localhost:11434</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground-secondary">{t('settings.models.model')}</span>
          <span className="font-mono font-medium text-action">qwen2.5-coder:7b</span>
        </div>
      </div>

      {/* Fallback Chains & Routing */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          {t('settings.models.fallback')}
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2.5 text-xs text-foreground-secondary space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Primary:</span>
            <span>Ollama / qwen2.5-coder:7b</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Secondary fallback:</span>
            <span>Ollama / llama3.2:3b</span>
          </div>
        </div>
        <p className="text-[11px] text-foreground-muted">
          Policy: Work never crosses from local execution to cloud providers without explicit
          approval.
        </p>
      </div>
    </div>
  );
}
