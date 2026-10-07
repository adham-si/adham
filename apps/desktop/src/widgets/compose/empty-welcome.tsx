import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';

export interface EmptyWelcomeProps {
  onSelectPrompt?: (prompt: string) => void;
}

export function EmptyWelcome({ onSelectPrompt }: EmptyWelcomeProps) {
  const { t } = useTranslation();

  const suggestionPrompts = [
    {
      title: 'Analyze codebase architecture',
      desc: 'Inspect crates, bounded contexts, and dependency isolation',
      prompt: 'Please analyze the architecture and module boundaries of this project.',
    },
    {
      title: 'Draft execution plan',
      desc: 'Formulate an end-to-end plan with verified step gates',
      prompt: 'Draft an execution plan with test evidence verification gates.',
    },
    {
      title: 'Audit design tokens',
      desc: 'Verify zero magic values and complete color contrast',
      prompt: 'Run an audit of design token contracts, contrast, and layout scaling.',
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center select-none">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-selection">
        <span className="text-2xl font-bold text-accent">🐎</span>
      </div>
      <h2 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">{t('welcome')}</h2>
      <p className="max-w-md text-sm text-foreground-secondary mb-8">
        A private workspace where people and intelligent agents work together safely.
      </p>

      {/* Suggestion Prompts */}
      <div className="grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-3">
        {suggestionPrompts.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => onSelectPrompt?.(item.prompt)}
            className="flex flex-col items-start rounded-lg border border-border-subtle bg-surface p-3 text-start transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <AdhamIcon size="sm" className="text-action">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </AdhamIcon>
              <span>{item.title}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-foreground-muted">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
