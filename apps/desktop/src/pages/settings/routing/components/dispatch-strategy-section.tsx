import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface DispatchStrategySectionProps {
  strategy: string;
  timeout: string;
  autoRetry: boolean;
  streaming: boolean;
  onStrategyChange: (val: string) => void;
  onTimeoutChange: (val: string) => void;
  onAutoRetryChange: (val: boolean) => void;
  onStreamingChange: (val: boolean) => void;
}

export function DispatchStrategySection({
  strategy,
  timeout,
  autoRetry,
  streaming,
  onStrategyChange,
  onTimeoutChange,
  onAutoRetryChange,
  onStreamingChange,
}: DispatchStrategySectionProps) {
  const { t } = useTranslation();
  const strategyOptions: SelectOption[] = [
    {
      value: 'local-only',
      label: t('settings.routing.strategyLocalOnly', 'Local-Only (Zero Egress)'),
    },
    { value: 'balanced', label: t('settings.routing.strategyBalanced', 'Cost-Optimized Hybrid') },
    { value: 'performance', label: t('settings.routing.strategyPerformance', 'Performance-First') },
    { value: 'latency', label: t('settings.routing.strategyLatency', 'Lowest Latency Priority') },
  ];
  const timeoutOptions: SelectOption[] = [
    { value: '15s', label: t('settings.routing.seconds', { count: 15 }) },
    { value: '30s', label: t('settings.routing.seconds', { count: 30 }) },
    { value: '60s', label: t('settings.routing.seconds', { count: 60 }) },
    { value: '120s', label: t('settings.routing.seconds', { count: 120 }) },
  ];
  return (
    <section aria-labelledby="dispatch-policy-heading" className="space-y-4">
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="dispatch-policy-heading" className="text-sm font-semibold text-foreground">
          {t('settings.routing.dispatchTitle', 'Dispatch policy')}
        </h3>
        <p className="text-xs text-foreground-secondary mt-0.5">
          {t(
            'settings.routing.dispatchHint',
            'Define execution priority and timeout limits across local runtimes and cloud backends.',
          )}
        </p>
      </div>

      <div className="space-y-4">
        {/* Strategy Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.strategyLabel', 'Routing strategy')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.strategyHint',
                'Determine how tasks are assigned between local Ollama and cloud engines',
              )}
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="routing-strategy-select"
              size="sm"
              value={strategy}
              options={strategyOptions}
              onValueChange={onStrategyChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Timeout Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.timeoutLabel', 'Inference timeout')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.timeoutHint',
                'Maximum elapsed time before triggering fallback or halting execution',
              )}
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="inference-timeout-select"
              size="sm"
              value={timeout}
              options={timeoutOptions}
              onValueChange={onTimeoutChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Auto-retry Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.autoRetryLabel', 'Auto-retry on error')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.autoRetryHint',
                'Automatically attempt secondary model when primary endpoint fails or times out',
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoRetry}
            aria-label={t('settings.routing.autoRetryLabel', 'Auto-retry on error')}
            onClick={() => onAutoRetryChange(!autoRetry)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-focus ${
              autoRetry ? 'bg-brand' : 'bg-surface-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-action-foreground shadow-sm ring-0 transition duration-200 ease-in-out ${
                autoRetry ? 'translate-x-4.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Streaming Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.streamingLabel', 'Stream token responses')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.streamingHint',
                'Render partial model generations token-by-token in the chat interface',
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={streaming}
            aria-label={t('settings.routing.streamingLabel', 'Stream token responses')}
            onClick={() => onStreamingChange(!streaming)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-focus ${
              streaming ? 'bg-brand' : 'bg-surface-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-action-foreground shadow-sm ring-0 transition duration-200 ease-in-out ${
                streaming ? 'translate-x-4.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
