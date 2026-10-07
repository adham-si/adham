import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function RoutingPage() {
  const { t } = useTranslation();
  const [strategy, setStrategy] = React.useState('local-only');
  const [autoRetry, setAutoRetry] = React.useState(true);
  const [timeout, setTimeout] = React.useState('30s');
  const [promptCloud, setPromptCloud] = React.useState(true);
  const [streaming, setStreaming] = React.useState(true);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.routing.title', { defaultValue: 'Routing & Fallbacks' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.routing.desc', {
            defaultValue:
              'Configure model dispatch policies, latency optimization, and fallback cascades.',
          })}
        </p>
      </div>

      {/* Dispatch Policy Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Dispatch policy</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Strategy Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Routing strategy</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Determine how tasks are assigned between local Ollama and cloud engines
              </div>
            </div>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="local-only">Local-Only (Zero Egress)</option>
              <option value="balanced">Cost-Optimized Hybrid</option>
              <option value="performance">Performance-First</option>
            </select>
          </div>

          {/* Auto-retry Row */}
          <div className="flex items-center justify-between py-3">
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
              onClick={() => setAutoRetry(!autoRetry)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                autoRetry ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  autoRetry ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Timeout Row */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Inference timeout</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Maximum elapsed time before triggering fallback or halting execution
              </div>
            </div>
            <select
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              className="min-h-control-sm rounded-md border border-border-subtle bg-surface px-3 py-1 text-xs text-foreground cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="15s">15 seconds</option>
              <option value="30s">30 seconds</option>
              <option value="60s">60 seconds</option>
              <option value="120s">120 seconds</option>
            </select>
          </div>
        </div>
      </div>

      {/* Fallback Cascades Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Fallback cascades</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Cloud crossing prompt */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                Require confirmation before cloud egress
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Prevent local data from sending to third-party APIs without manual approval
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={promptCloud}
              aria-label="Require confirmation before cloud egress"
              onClick={() => setPromptCloud(!promptCloud)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                promptCloud ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  promptCloud ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Streaming toggle */}
          <div className="flex items-center justify-between py-3">
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
              onClick={() => setStreaming(!streaming)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                streaming ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  streaming ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
