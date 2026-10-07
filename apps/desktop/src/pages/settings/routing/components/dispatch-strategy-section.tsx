import * as React from 'react';
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

const STRATEGY_OPTIONS: SelectOption[] = [
  { value: 'local-only', label: 'Local-Only (Zero Egress)' },
  { value: 'balanced', label: 'Cost-Optimized Hybrid' },
  { value: 'performance', label: 'Performance-First' },
  { value: 'latency', label: 'Lowest Latency Priority' },
];

const TIMEOUT_OPTIONS: SelectOption[] = [
  { value: '15s', label: '15 seconds' },
  { value: '30s', label: '30 seconds' },
  { value: '60s', label: '60 seconds' },
  { value: '120s', label: '120 seconds' },
];

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
  return (
    <section aria-labelledby="dispatch-policy-heading" className="space-y-4">
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="dispatch-policy-heading" className="text-sm font-semibold text-foreground">
          Dispatch policy
        </h3>
        <p className="text-xs text-foreground-secondary mt-0.5">
          Define execution priority and timeout limits across local runtimes and cloud backends.
        </p>
      </div>

      <div className="space-y-4">
        {/* Strategy Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">Routing strategy</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Determine how tasks are assigned between local Ollama and cloud engines
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="routing-strategy-select"
              size="sm"
              value={strategy}
              options={STRATEGY_OPTIONS}
              onValueChange={onStrategyChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Timeout Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">Inference timeout</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Maximum elapsed time before triggering fallback or halting execution
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="inference-timeout-select"
              size="sm"
              value={timeout}
              options={TIMEOUT_OPTIONS}
              onValueChange={onTimeoutChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Auto-retry Row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Auto-retry on error</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Automatically attempt secondary model when primary endpoint fails or times out
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoRetry}
            aria-label="Auto-retry on error"
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
            <div className="text-sm font-medium text-foreground">Stream token responses</div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Render partial model generations token-by-token in the chat interface
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={streaming}
            aria-label="Stream token responses"
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
