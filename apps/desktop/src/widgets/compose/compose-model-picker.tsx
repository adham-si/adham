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
  supportsReasoning?: boolean | undefined;
}

export const DEFAULT_MODELS: ModelOption[] = [
  {
    id: 'local:qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'Ollama',
    boundary: 'local',
    description: 'Offline, private, high code intelligence',
    supportsReasoning: false,
  },
  {
    id: 'local:deepseek-r1:14b',
    name: 'DeepSeek R1 14B',
    provider: 'Ollama',
    boundary: 'local',
    description: 'Offline reasoning model running on local GPU',
    supportsReasoning: true,
  },
  {
    id: 'cloud:claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    boundary: 'cloud',
    description: 'High capacity hybrid thinking model (requires API transfer)',
    supportsReasoning: true,
  },
  {
    id: 'cloud:gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    boundary: 'cloud',
    description: 'Fast cloud multimodal model',
    supportsReasoning: false,
  },
];

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
  models = DEFAULT_MODELS,
  disabled = false,
  className = '',
}: ComposeModelPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedModel = models.find((m) => m.id === selectedModelId) || models[0]!;

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

  const isLocal = selectedModel.boundary === 'local';

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Select model. Current model is ${selectedModel.name}, ${
          isLocal ? 'running locally' : 'cloud provider'
        }`}
        className="group flex min-h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
      >
        {/* Model Name */}
        <span className="font-medium text-foreground">{selectedModel.name}</span>

        {/* Data Boundary Badge */}
        <span
          className={`flex items-center gap-1 rounded-sm px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider ${
            isLocal
              ? 'bg-success/15 text-success'
              : 'bg-action/15 text-action'
          }`}
          title={isLocal ? 'Zero data leaves this machine' : `Outbound request to ${selectedModel.provider}`}
        >
          <HugeiconsIcon
            icon={isLocal ? CpuIcon : AiCloud01Icon}
            className="size-3"
          />
          <span>{isLocal ? 'Local' : selectedModel.provider}</span>
        </span>

        {/* Reasoning tag if active */}
        {selectedModel.supportsReasoning && (
          <span className="hidden sm:inline-block rounded bg-surface px-1 py-0.2 text-[10px] text-foreground-muted border border-border-subtle">
            {reasoningEffort} effort
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
          aria-label="Available models"
          className="absolute bottom-full mb-1.5 end-0 z-50 w-72 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-foreground-muted">
            {t('compose.modelsHeading', 'Models & Privacy Boundary')}
          </div>

          <div className="space-y-0.5">
            {models.map((model) => {
              const isSelected = model.id === selectedModel.id;
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
                          modelLocal
                            ? 'bg-success/15 text-success'
                            : 'bg-action/15 text-action'
                        }`}
                      >
                        {modelLocal ? 'Local' : 'Cloud'}
                      </span>
                    </div>
                    {model.description && (
                      <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
                        {model.description}
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
          {selectedModel.supportsReasoning && onChangeReasoningEffort && (
            <div className="mt-2 border-t border-border-subtle pt-2 px-1">
              <div className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider mb-1">
                Reasoning Effort
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
                    {tier}
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
