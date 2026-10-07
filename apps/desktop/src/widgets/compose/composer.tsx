import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Textarea, AdhamIcon } from '@adham/ui';

export type ComposeMode = 'ask' | 'plan' | 'execute' | 'code';

export interface ComposerProps {
  inputText: string;
  onChangeInput: (text: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

export function Composer({
  inputText,
  onChangeInput,
  onSubmit,
  isSubmitting = false,
}: ComposerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<ComposeMode>('plan');

  const modes: Array<{ id: ComposeMode; label: string }> = [
    { id: 'ask', label: t('compose.modes.ask') },
    { id: 'plan', label: t('compose.modes.plan') },
    { id: 'execute', label: t('compose.modes.execute') },
    { id: 'code', label: t('compose.modes.code') },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim() && !isSubmitting) {
        onSubmit();
      }
    }
  };

  return (
    <footer className="border-t border-border-subtle bg-surface p-4">
      <div className="mx-auto max-w-4xl rounded-xl border border-border-subtle bg-background p-3 shadow-sm focus-within:border-focus">
        {/* Upper Row: Active Agent & Context */}
        <div className="mb-2 flex items-center justify-between text-xs text-foreground-secondary">
          <div className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-0.5">
            <AdhamIcon size="sm" className="text-running">
              <circle cx="12" cy="12" r="4" />
            </AdhamIcon>
            <span className="font-medium text-foreground">{t('compose.agent')}</span>
          </div>

          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-foreground-muted">
            Isolated project sandbox
          </span>
        </div>

        {/* Text Input */}
        <Textarea
          value={inputText}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('compose.placeholder')}
          rows={3}
          className="border-none bg-transparent p-1 focus-visible:outline-none focus:ring-0"
        />

        {/* Lower Control Row */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle">
          {/* Leading Controls: Mode Chips */}
          <div className="flex items-center gap-1">
            {modes.map((m) => {
              const isActive = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`flex min-h-control-sm items-center rounded-md px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    isActive
                      ? 'bg-selection font-medium text-action'
                      : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Trailing Controls: Model Picker, Privacy & Send */}
          <div className="flex items-center gap-2">
            <div className="flex min-h-control-sm items-center gap-1 rounded-md bg-surface-subtle px-2 text-xs text-foreground-secondary">
              <AdhamIcon size="sm" className="text-action">
                <path d="M12 2v20m10-10H2" />
              </AdhamIcon>
              <span>{t('compose.model')}</span>
            </div>

            <div className="flex min-h-control-sm items-center gap-1 rounded-md bg-surface-subtle px-2 text-xs text-foreground-secondary">
              <span className="size-1.5 rounded-full bg-success" />
              <span>{t('compose.privacy')}</span>
            </div>

            <Button
              type="button"
              size="sm"
              disabled={!inputText.trim() || isSubmitting}
              onClick={onSubmit}
            >
              {isSubmitting ? t('status.loading') : t('compose.send')}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}
