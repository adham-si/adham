import * as React from 'react';
import { Select, type SelectOption } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface FallbackCascadesSectionProps {
  promptCloud: boolean;
  maxCascades: string;
  onPromptCloudChange: (val: boolean) => void;
  onMaxCascadesChange: (val: string) => void;
}

const CASCADE_OPTIONS: SelectOption[] = [
  { value: '1', label: '1 fallback model' },
  { value: '2', label: '2 fallback models' },
  { value: '3', label: '3 fallback models' },
  { value: 'all', label: 'All configured models' },
];

export function FallbackCascadesSection({
  promptCloud,
  maxCascades,
  onPromptCloudChange,
  onMaxCascadesChange,
}: FallbackCascadesSectionProps) {
  return (
    <section aria-labelledby="fallback-cascades-heading" className="space-y-4">
      <div className="border-b border-border-subtle pb-2.5">
        <h3 id="fallback-cascades-heading" className="text-sm font-semibold text-foreground">
          Fallback cascades & safety
        </h3>
        <p className="text-xs text-foreground-secondary mt-0.5">
          Configure failover recovery behaviors and local privacy isolation rules.
        </p>
      </div>

      <div className="space-y-4">
        {/* Cloud crossing prompt */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">
              Require confirmation before cloud egress
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Prevent local workspace data from dispatching to third-party APIs without manual
              approval
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={promptCloud}
            aria-label="Require confirmation before cloud egress"
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
              Maximum fallback cascade depth
            </div>
            <div className="text-xs text-foreground-secondary mt-0.5">
              Number of sequential fallback engines attempted before marking the task paused
            </div>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <Select
              id="fallback-depth-select"
              size="sm"
              value={maxCascades}
              options={CASCADE_OPTIONS}
              onValueChange={onMaxCascadesChange}
              indicator={<HugeiconsIcon icon={ArrowDown01Icon} />}
              indicatorOpen={<HugeiconsIcon icon={ArrowUp01Icon} />}
            />
          </div>
        </div>

        {/* Trigger conditions informational pills */}
        <div className="rounded-lg bg-surface-subtle/50 p-3 border border-border-subtle/40 space-y-2">
          <div className="text-xs font-semibold text-foreground">Active failover triggers</div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              HTTP 429 Rate Limits
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              HTTP 500 / 503 Provider Outages
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              Context Window Limits Exceeded
            </span>
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-2xs font-medium text-foreground-secondary border border-border-subtle">
              Inference Timeout Exceeded
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
