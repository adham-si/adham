import * as React from 'react';
import { useTranslation } from 'react-i18next';

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
    // No policy/tool runtime exists to execute under: the chip is disabled
    // with the reason instead of dispatching a turn that cannot execute.
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

  return (
    <div
      role="radiogroup"
      aria-label={t('compose.modeLabel', 'Execution mode')}
      className={`inline-flex items-center gap-0.5 rounded-lg bg-surface-subtle p-0.5 border border-border-subtle ${className}`}
    >
      {MODES.map((item) => {
        const isSelected = mode === item.id;
        const isUnavailable = item.unavailableKey !== undefined;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled || isUnavailable}
            onClick={() => onChangeMode(item.id)}
            title={
              item.unavailableKey
                ? t(
                    item.unavailableKey,
                    'Execution requires the policy and tool runtime, which is not built yet',
                  )
                : t(item.hintKey)
            }
            className={`flex min-h-6 items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50 ${
              isSelected
                ? 'bg-selection text-action'
                : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
            }`}
          >
            {t(item.labelKey, item.defaultLabel)}
          </button>
        );
      })}
    </div>
  );
}
