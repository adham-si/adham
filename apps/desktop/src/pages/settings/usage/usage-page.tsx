import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function UsagePage() {
  const { t } = useTranslation();

  const metrics = [
    { label: 'Total Invocations', value: '42', change: '+12 today' },
    { label: 'Prompt Tokens', value: '84,210', change: 'Local engine' },
    { label: 'Completion Tokens', value: '29,400', change: 'Local engine' },
    { label: 'Cloud Egress Cost', value: '$0.00', change: '100% on-device' },
  ];

  const recentModels = [
    { model: 'qwen2.5-coder:7b', provider: 'Ollama (Local)', calls: 36, percentage: '85%' },
    { model: 'llama3.2:3b', provider: 'Ollama (Local)', calls: 6, percentage: '15%' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.usage.title', { defaultValue: 'Usage & Analytics' })}
        </h3>
        <p className="text-xs text-foreground-secondary">
          {t('settings.usage.desc', {
            defaultValue:
              'Local resource consumption metrics, token counts, and invocation breakdowns.',
          })}
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-border-subtle bg-surface-subtle p-3 space-y-1"
          >
            <span className="text-xs font-medium text-foreground-secondary">{m.label}</span>
            <div className="text-base font-bold text-foreground font-mono">{m.value}</div>
            <div className="text-xs text-success font-medium">{m.change}</div>
          </div>
        ))}
      </div>

      {/* Model Breakdown */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Model Utilization
        </div>
        <div className="space-y-2">
          {recentModels.map((row) => (
            <div
              key={row.model}
              className="flex items-center justify-between rounded border border-border-subtle bg-surface p-2.5 text-xs"
            >
              <div>
                <span className="font-semibold text-foreground">{row.model}</span>
                <span className="ms-2 text-foreground-secondary text-xs">{row.provider}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-foreground-secondary">{row.calls} calls</span>
                <span className="rounded bg-selection px-1.5 py-0.5 text-xs font-medium text-action">
                  {row.percentage}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
