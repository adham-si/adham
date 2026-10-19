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
  supportsReasoning?: boolean | undefined;
  /** `/api/show` `thinking.values`: the only values this model documents for
   *  `think` ("true"/"false" and/or named levels). Absent = no metadata, so
   *  no control may be offered. */
  thinkingValues?: string[] | undefined;
  /** The value Ollama uses when `think` is absent, when documented. */
  thinkingDefault?: string | null | undefined;
}

export interface ComposeModelPickerProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  /** Documented `think` value for the next turn: false, a named level, or
   *  null for the model default. Only values in the model's documented list
   *  are offered here (and re-validated by the backend). */
  think?: boolean | string | null | undefined;
  onChangeThink?: ((value: boolean | string | null) => void) | undefined;
  models?: ModelOption[] | undefined;
  /** No provider/model is set up (as opposed to still loading). */
  unavailable?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ComposeModelPicker({
  selectedModelId,
  onSelectModel,
  think = null,
  onChangeThink,
  models = [],
  unavailable = false,
  disabled = false,
  className = '',
}: ComposeModelPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Selection is explicit: nothing is auto-displayed as chosen before the
  // user picks; discovery order is never a default.
  const selectedModel = selectedModelId
    ? (models.find((m) => m.id === selectedModelId) ?? null)
    : null;
  const selectedLabel =
    selectedModel?.name ??
    (models.length === 0 && unavailable
      ? t('compose.noModelAvailable', 'No model available')
      : t('compose.selectModel', 'Select a model'));

  // Thinking controls come only from the model's documented `think` values:
  // on/off when "false"/"true" are documented, named levels verbatim. A model
  // without documented values gets no control (nothing may be sent for it).
  const documentedThinking = selectedModel?.thinkingValues ?? [];
  const permitsOff = documentedThinking.includes('false');
  const permitsOn = documentedThinking.includes('true');
  const thinkingLevels = documentedThinking.filter(
    (value) => value !== 'true' && value !== 'false',
  );
  const hasThinkingControl =
    Boolean(selectedModel?.supportsReasoning) && (permitsOff || thinkingLevels.length > 0);
  const thinkingSelectionClass = (selected: boolean) =>
    `min-h-control-sm rounded-md px-3 text-xs capitalize transition-colors ${
      selected
        ? 'bg-selection font-medium text-action border border-focus'
        : 'bg-surface-subtle text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
    }`;

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

  // Always visible: an empty registry is a state of the control, not a reason
  // to hide it — the composer's text-only path is disclosed here instead of
  // in a separate sentence.
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
            : selectedLabel
        }
        className="group flex min-h-control-sm items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-3 py-1 text-xs text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
      >
        {/* Model Name */}
        <span className="font-medium text-foreground">{selectedLabel}</span>

        {/* Data Boundary Badge */}
        {selectedModel && (
          <span
            className={`flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
              isLocal ? 'bg-success/15 text-success' : 'bg-action/15 text-action'
            }`}
            title={
              isLocal
                ? t('compose.localBoundaryNote', 'Zero data leaves this machine')
                : t('compose.cloudBoundaryNote', { provider: selectedModel.provider })
            }
          >
            <HugeiconsIcon icon={isLocal ? CpuIcon : AiCloud01Icon} className="size-4" />
            <span>{isLocal ? t('compose.localBadge', 'Local') : selectedModel.provider}</span>
          </span>
        )}

        {/* Thinking state tag: a documented non-default choice only. */}
        {hasThinkingControl && think !== null && think !== true && (
          <span className="hidden rounded-sm border border-border-subtle bg-surface px-2 py-0.5 text-xs text-foreground-muted sm:inline-block">
            {think === false ? t('compose.thinkingOffTag', 'No thinking') : think}
          </span>
        )}

        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-4 text-foreground-muted transition-transform group-hover:text-foreground"
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={t('compose.modelsAria', 'Available models')}
          className="absolute bottom-full end-0 z-popover mb-2 w-72 rounded-lg border border-border-subtle bg-surface p-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-2 text-xs font-semibold text-foreground-muted">
            {t('compose.modelsHeading', 'Models & Privacy Boundary')}
          </div>

          {models.length === 0 ? (
            <p className="px-2 py-2 text-xs text-foreground-muted">
              {t('compose.modelSetupHint', 'Set up a model in Settings → AI Providers')}
            </p>
          ) : (
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
                    className={`flex w-full items-start gap-2 rounded-md p-2 text-start transition-colors ${
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
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">{model.name}</span>
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase ${
                            modelLocal ? 'bg-success/15 text-success' : 'bg-action/15 text-action'
                          }`}
                        >
                          {modelLocal
                            ? t('compose.localBadge', 'Local')
                            : t('compose.cloudBadge', 'Cloud')}
                        </span>
                      </div>
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
          )}

          {/* Documented `think` controls: on/off only when the model lists
              those booleans, levels verbatim, plus the documented default. */}
          {hasThinkingControl && onChangeThink && (
            <div className="mt-2 border-t border-border-subtle px-1 pt-2">
              <div className="mb-2 text-xs font-semibold text-foreground-muted uppercase tracking-wider">
                {t('compose.thinkingHeading', 'Thinking')}
              </div>
              {permitsOff && (
                <label className="flex items-center gap-2 text-xs text-foreground-secondary">
                  <input
                    type="checkbox"
                    checked={think === false}
                    onChange={(e) =>
                      onChangeThink(e.target.checked ? false : permitsOn ? true : null)
                    }
                    className="size-4 accent-action"
                  />
                  <span>{t('compose.disableThinking', 'Disable thinking')}</span>
                </label>
              )}
              {thinkingLevels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onChangeThink(null)}
                    className={thinkingSelectionClass(think === null)}
                  >
                    {selectedModel?.thinkingDefault
                      ? `${t('compose.thinkingDefault', 'Model default')} (${selectedModel.thinkingDefault})`
                      : t('compose.thinkingDefault', 'Model default')}
                  </button>
                  {thinkingLevels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onChangeThink(level)}
                      className={thinkingSelectionClass(think === level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
