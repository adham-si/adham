import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';

export function RoutingPage() {
  const { t } = useTranslation();
  const [strategy, setStrategy] = React.useState<'local-only' | 'balanced' | 'performance'>(
    'local-only',
  );

  const strategies: Array<{
    id: 'local-only' | 'balanced' | 'performance';
    label: string;
    desc: string;
  }> = [
    {
      id: 'local-only',
      label: 'Local-Only (Zero Egress)',
      desc: 'Routes 100% of tasks to Ollama local models. Never connects to external clouds.',
    },
    {
      id: 'balanced',
      label: 'Cost-Optimized Hybrid',
      desc: 'Local model first; falls back to low-cost cloud models for complex reasoning.',
    },
    {
      id: 'performance',
      label: 'Performance-First',
      desc: 'Routes to highest capability model regardless of local or cloud deployment.',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.routing.title', { defaultValue: 'Routing & Fallbacks' })}
        </h3>
        <p className="text-xs text-foreground-secondary">
          {t('settings.routing.desc', {
            defaultValue:
              'Configure deterministic model routing strategies, latency priorities, and fallback cascades.',
          })}
        </p>
      </div>

      {/* Routing Strategy Selection */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Active Routing Strategy
        </label>
        <div className="space-y-2">
          {strategies.map((item) => {
            const isSelected = strategy === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setStrategy(item.id)}
                className={`flex cursor-pointer items-start justify-between rounded-md border p-3 transition-colors ${
                  isSelected
                    ? 'border-action bg-selection text-foreground'
                    : 'border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-hover'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold text-foreground">{item.label}</div>
                  <div className="text-xs text-foreground-secondary">{item.desc}</div>
                </div>
                <Button
                  size="sm"
                  variant={isSelected ? 'primary' : 'secondary'}
                  className="shrink-0 pointer-events-none"
                >
                  {isSelected ? 'Active' : 'Select'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fallback Chain Details */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Deterministic Fallback Chain
        </div>
        <div className="rounded border border-border-subtle bg-surface p-2.5 text-xs text-foreground-secondary space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Step 1:</span>
            <span>Local Ollama (qwen2.5-coder:7b) • Timeout: 15s</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Step 2:</span>
            <span>Secondary Local (llama3.2:3b) • Timeout: 10s</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Step 3:</span>
            <span>Offline Circuit Breaker (Fail Closed)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
