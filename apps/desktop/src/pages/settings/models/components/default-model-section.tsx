import * as React from 'react';
import type { ModelItem } from './model-card';

interface DefaultModelSectionProps {
  models: ModelItem[];
  defaultModelId: string;
  fallbackModelId: string;
  strictLocalBoundary: boolean;
  onSelectDefault: (id: string) => void;
  onSelectFallback: (id: string) => void;
  onToggleLocalBoundary: (val: boolean) => void;
}

export function DefaultModelSection({
  models,
  defaultModelId,
  fallbackModelId,
  strictLocalBoundary,
  onSelectDefault,
  onSelectFallback,
  onToggleLocalBoundary,
}: DefaultModelSectionProps) {
  const defaultModel = models.find((m) => m.id === defaultModelId);
  const fallbackModel = models.find((m) => m.id === fallbackModelId);

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-border-subtle pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Workspace Defaults & Routing</h3>
          <p className="text-xs text-foreground-secondary mt-0.5">
            Configure the default intelligence runtime and automatic recovery chain.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Default Model Selector */}
        <div className="space-y-2">
          <label htmlFor="default-model-select" className="text-xs font-medium text-foreground">
            Primary Default Model
          </label>
          <div className="relative">
            <select
              id="default-model-select"
              value={defaultModelId}
              onChange={(e) => onSelectDefault(e.target.value)}
              className="w-full min-h-control-md rounded-md border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-focus cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider}) — {m.contextWindow}
                </option>
              ))}
            </select>
          </div>
          {defaultModel && (
            <div className="flex items-center gap-2 rounded-md bg-surface-subtle/60 p-2 text-xs text-foreground-secondary">
              <div className="size-5 shrink-0 overflow-hidden flex items-center justify-center">
                {defaultModel.icon}
              </div>
              <span className="truncate">
                Dispatched by default for interactive agent workflows.
              </span>
            </div>
          )}
        </div>

        {/* Fallback Model Selector */}
        <div className="space-y-2">
          <label htmlFor="fallback-model-select" className="text-xs font-medium text-foreground">
            Automatic Fallback Model
          </label>
          <div className="relative">
            <select
              id="fallback-model-select"
              value={fallbackModelId}
              onChange={(e) => onSelectFallback(e.target.value)}
              className="w-full min-h-control-md rounded-md border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-focus cursor-pointer"
            >
              {models
                .filter((m) => m.id !== defaultModelId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider}) — {m.contextWindow}
                  </option>
                ))}
            </select>
          </div>
          {fallbackModel && (
            <div className="flex items-center gap-2 rounded-md bg-surface-subtle/60 p-2 text-xs text-foreground-secondary">
              <div className="size-5 shrink-0 overflow-hidden flex items-center justify-center">
                {fallbackModel.icon}
              </div>
              <span className="truncate">
                Activates when primary reaches rate limits or has an outage.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Local-first Boundary Toggle */}
      <div className="flex items-center justify-between pt-2 border-t border-border-subtle/50">
        <div className="space-y-0.5 max-w-[80%]">
          <span className="text-xs font-medium text-foreground">Strict local privacy boundary</span>
          <p className="text-xs text-foreground-secondary">
            Never silently fallback from local models to cloud providers without explicit
            confirmation.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={strictLocalBoundary}
          onClick={() => onToggleLocalBoundary(!strictLocalBoundary)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-focus ${
            strictLocalBoundary ? 'bg-brand' : 'bg-surface-muted'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-action-foreground shadow-sm ring-0 transition duration-200 ease-in-out ${
              strictLocalBoundary ? 'translate-x-4.5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
