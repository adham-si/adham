import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface FallbackCascadesSectionProps {
  promptCloud: boolean;
  maxCascades: string;
  onPromptCloudChange: (val: boolean) => void;
  onMaxCascadesChange: (val: string) => void;
}

export function FallbackCascadesSection({
  promptCloud,
  maxCascades,
  onPromptCloudChange,
  onMaxCascadesChange,
}: FallbackCascadesSectionProps) {
  const { t } = useTranslation();
  const cascadeOptions: SelectOption[] = [
    { value: '1', label: t('settings.routing.fallbackModels', { count: 1 }) },
    { value: '2', label: t('settings.routing.fallbackModels', { count: 2 }) },
    { value: '3', label: t('settings.routing.fallbackModels', { count: 3 }) },
    { value: 'all', label: t('settings.routing.fallbackAll', 'All configured models') },
  ];
  return (
    <section aria-labelledby="fallback-cascades-heading" className="space-y-4">
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="fallback-cascades-heading" className="text-sm font-semibold text-foreground">
          {t('settings.routing.fallbackTitle', 'Fallback cascades & safety')}
        </h3>
        <p className="text-xs text-foreground-secondary mt-0.5">
          {t(
            'settings.routing.fallbackHint',
            'Configure failover recovery behaviors and local privacy isolation rules.',
          )}
        </p>
      </div>

      <div className="space-y-4">
        {/* Cloud crossing prompt */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.promptCloudLabel', 'Require confirmation before cloud egress')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.promptCloudHint',
                'Prevent local workspace data from dispatching to third-party APIs without manual approval',
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={promptCloud}
            aria-label={t(
              'settings.routing.promptCloudLabel',
              'Require confirmation before cloud egress',
            )}
            onClick={() => onPromptCloudChange(!promptCloud)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-focus ${
              promptCloud ? 'bg-brand' : 'bg-surface-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-action-foreground shadow-sm ring-0 transition duration-200 ease-in-out ${
                promptCloud ? 'translate-x-4.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Max Cascade Depth Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">
              {t('settings.routing.maxDepthLabel', 'Maximum fallback cascade depth')}
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              {t(
                'settings.routing.maxDepthHint',
                'Number of sequential fallback engines attempted before marking the task paused',
              )}
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="fallback-depth-select"
              size="sm"
              value={maxCascades}
              options={cascadeOptions}
              onValueChange={onMaxCascadesChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Trigger conditions informational pills */}
        <div className="rounded-lg bg-surface-subtle/50 p-3 border border-border-subtle/40 space-y-2">
          <div className="text-xs font-semibold text-foreground">
            {t('settings.routing.triggersTitle', 'Active failover triggers')}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              {t('settings.routing.triggerRateLimit', 'HTTP 429 Rate Limits')}
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              {t('settings.routing.triggerOutage', 'HTTP 500 / 503 Provider Outages')}
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              {t('settings.routing.triggerContext', 'Context Window Limits Exceeded')}
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              {t('settings.routing.triggerTimeout', 'Inference Timeout Exceeded')}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
