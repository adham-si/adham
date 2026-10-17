import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiCloud01Icon,
  CpuIcon,
  CheckmarkBadge01Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons';

export type ModelBoundary = 'local' | 'cloud';

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  boundary: ModelBoundary;
  description?: string | undefined;
  /** Resource key for the translated description; falls back to description. */
  descKey?: string | undefined;
  supportsReasoning?: boolean | undefined;
}

export interface ComposeModelPickerProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  reasoningEffort?: ('low' | 'medium' | 'high') | undefined;
  onChangeReasoningEffort?: ((effort: 'low' | 'medium' | 'high') => void) | undefined;
  models?: ModelOption[] | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ComposeModelPicker({
  selectedModelId,
  onSelectModel,
  reasoningEffort = 'medium',
  onChangeReasoningEffort,
  models = [],
  disabled = false,
  className = '',
}: ComposeModelPickerProps) {
  const { t } = useTranslation();
  const effortLabels = {
    low: t('settings.models.effortLow', 'low effort'),
    medium: t('settings.models.effortMedium', 'medium effort'),
    high: t('settings.models.effortHigh', 'high effort'),
  } as const;
  const tierLabels = {
    low: t('settings.models.tierLow', 'Low'),
    medium: t('settings.models.tierMedium', 'Medium'),
    high: t('settings.models.tierHigh', 'High'),
  } as const;
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Selection is explicit: nothing is auto-displayed as chosen before the
  // user picks; discovery order is never a default.
  const selectedModel = selectedModelId
    ? (models.find((m) => m.id === selectedModelId) ?? null)
    : null;
  const selectedLabel = selectedModel?.name ?? t('compose.selectModel', 'Select a model');

  // Close popup when clicking outside or pressing Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // No registry models: no picker — the composer runs the honest text-only
  // path, so unsupported "catalog" entries are never shown. (Placed after
  // every hook: the early return must never skip a hook.)
  if (models.length === 0) return null;
  const isLocal = selectedModel?.boundary === 'local';

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={
          selectedModel
            ? `Select model. Current model is ${selectedModel.name}, ${
                isLocal ? 'running locally' : 'cloud provider'
              }`
            : 'Select a model'
        }
        className="group flex min-h-control-xs items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
      >
        {/* Model Name */}
        <span className="font-medium text-foreground">{selectedLabel}</span>

        {/* Data Boundary Badge */}
        {selectedModel && (
          <span
            className={`flex items-center gap-1 rounded-sm px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider ${
              isLocal ? 'bg-success/15 text-success' : 'bg-action/15 text-action'
            }`}
            title={
              isLocal
                ? t('compose.localBoundaryNote', 'Zero data leaves this machine')
                : t('compose.cloudBoundaryNote', { provider: selectedModel.provider })
            }
          >
            <HugeiconsIcon icon={isLocal ? CpuIcon : AiCloud01Icon} className="size-3" />
            <span>{isLocal ? t('compose.localBadge', 'Local') : selectedModel.provider}</span>
          </span>
        )}

        {/* Reasoning tag if active */}
        {selectedModel?.supportsReasoning && (
          <span className="hidden sm:inline-block rounded bg-surface px-1 py-0.2 text-[10px] text-foreground-muted border border-border-subtle">
            {effortLabels[reasoningEffort]}
          </span>
        )}

        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 text-foreground-muted transition-transform group-hover:text-foreground"
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={t('compose.modelsAria', 'Available models')}
          className="absolute bottom-full mb-1.5 end-0 z-popover w-72 rounded-xl border border-border-subtle bg-surface p-1.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-foreground-muted">
            {t('compose.modelsHeading', 'Models & Privacy Boundary')}
          </div>

          <div className="space-y-0.5">
            {models.map((model) => {
              const isSelected = selectedModel !== null && model.id === selectedModel.id;
              const modelLocal = model.boundary === 'local';

              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectModel(model.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg p-2 text-start transition-colors ${
                    isSelected
                      ? 'bg-selection text-action'
                      : 'hover:bg-surface-hover text-foreground'
                  }`}
                >
                  <div className="mt-0.5 text-foreground-secondary">
                    <HugeiconsIcon
                      icon={modelLocal ? CpuIcon : AiCloud01Icon}
                      className={`size-4 ${modelLocal ? 'text-success' : 'text-action'}`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{model.name}</span>
                      <span
                        className={`rounded px-1 py-0.2 text-[9px] font-semibold uppercase ${
                          modelLocal ? 'bg-success/15 text-success' : 'bg-action/15 text-action'
                        }`}
                      >
                        {modelLocal
                          ? t('compose.localBadge', 'Local')
                          : t('compose.cloudBadge', 'Cloud')}
                      </span>
                    </div>
                    {(model.descKey ?? model.description) && (
                      <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
                        {model.descKey
                          ? t(model.descKey, model.description ?? '')
                          : model.description}
                      </p>
                    )}
                  </div>

                  {isSelected && (
                    <div className="mt-0.5 text-action">
                      <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Reasoning Effort Section if current model supports reasoning */}
          {selectedModel?.supportsReasoning && onChangeReasoningEffort && (
            <div className="mt-2 border-t border-border-subtle pt-2 px-1">
              <div className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider mb-1">
                {t('settings.models.effortHeading', 'Reasoning Effort')}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['low', 'medium', 'high'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => onChangeReasoningEffort(tier)}
                    className={`rounded py-1 text-center text-xs capitalize transition-colors ${
                      reasoningEffort === tier
                        ? 'bg-selection font-medium text-action border border-focus'
                        : 'bg-surface-subtle text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
                    }`}
                  >
                    {tierLabels[tier]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
