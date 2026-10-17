import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, CheckmarkBadge01Icon } from '@hugeicons/core-free-icons';

export type ComposeMode = 'ask' | 'plan' | 'execute' | 'code';

export interface ComposeModeSelectorProps {
  mode: ComposeMode;
  onChangeMode: (mode: ComposeMode) => void;
  disabled?: boolean;
  className?: string;
}

const MODES: Array<{
  id: ComposeMode;
  labelKey: string;
  defaultLabel: string;
  hintKey: string;
  /** When set, the mode is not selectable and this key explains why. */
  unavailableKey?: string;
}> = [
  {
    id: 'ask',
    labelKey: 'compose.modes.ask',
    defaultLabel: 'Ask',
    hintKey: 'compose.modeHintAsk',
  },
  {
    id: 'plan',
    labelKey: 'compose.modes.plan',
    defaultLabel: 'Plan',
    hintKey: 'compose.modeHintPlan',
  },
  {
    id: 'execute',
    labelKey: 'compose.modes.execute',
    defaultLabel: 'Execute',
    hintKey: 'compose.modeHintExecute',
    // No policy/tool runtime exists to execute under: the entry explains
    // itself instead of dispatching a turn that cannot execute.
    unavailableKey: 'compose.modeExecuteUnavailable',
  },
  {
    id: 'code',
    labelKey: 'compose.modes.code',
    defaultLabel: 'Code',
    hintKey: 'compose.modeHintCode',
  },
];

export function ComposeModeSelector({
  mode,
  onChangeMode,
  disabled = false,
  className = '',
}: ComposeModeSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const selected = MODES.find((item) => item.id === mode) ?? MODES[1]!;

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

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`${t('compose.modeLabel', 'Execution mode')}: ${t(
          selected.labelKey,
          selected.defaultLabel,
        )}`}
        title={t('compose.modeLabel', 'Execution mode')}
        className="group flex min-h-control-xs items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
      >
        <span className="font-medium text-foreground">
          {t(selected.labelKey, selected.defaultLabel)}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3 text-foreground-muted transition-transform group-hover:text-foreground"
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={t('compose.modeLabel', 'Execution mode')}
          className="absolute bottom-full mb-1.5 start-0 z-popover w-64 rounded-xl border border-border-subtle bg-surface p-1.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="space-y-0.5">
            {MODES.map((item) => {
              const isSelected = mode === item.id;
              const isUnavailable = item.unavailableKey !== undefined;
              const hint = isUnavailable
                ? t(
                    item.unavailableKey!,
                    'Execution requires the policy and tool runtime, which is not built yet',
                  )
                : t(item.hintKey);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  // Unavailable modes stay focusable so the reason is
                  // reachable without a pointer; activation is refused.
                  aria-disabled={isUnavailable}
                  onClick={() => {
                    if (isUnavailable) return;
                    onChangeMode(item.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg p-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
                    isSelected
                      ? 'bg-selection text-action'
                      : isUnavailable
                        ? 'text-foreground-muted'
                        : 'text-foreground hover:bg-surface-hover'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {t(item.labelKey, item.defaultLabel)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-foreground-muted">{hint}</span>
                  </span>
                  {isSelected && (
                    <span className="mt-0.5 text-action">
                      <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
