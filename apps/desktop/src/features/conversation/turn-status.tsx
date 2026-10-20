import { HugeiconsIcon } from '@hugeicons/react';
import { BotMessageSquareIcon } from '@hugeicons/core-free-icons';
import { ROLE_LABEL } from '@adham/ui';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Live turn status while no answer text is on screen yet. "Waiting for the
 * model…" begins at dispatch; "Thinking…" appears only after real reasoning
 * activity from the provider — elapsed time is displayed next to the status
 * but never decides it. The moving dots are decorative; the words carry the
 * state.
 */
export function TurnStatus({
  phase,
  startedAt,
  name,
}: {
  phase: 'waiting' | 'thinking';
  startedAt: number;
  /** The model being awaited, when one is resolved. */
  name?: string | undefined;
}) {
  const { t } = useTranslation();
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return (
    <div className="flex max-w-[85%] flex-col gap-2 self-start">
      <header className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-subtle text-foreground-secondary"
        >
          <HugeiconsIcon icon={BotMessageSquareIcon} className="size-5" />
        </span>
        <span className="text-sm font-medium text-foreground">{name ?? ROLE_LABEL.assistant}</span>
      </header>
      <div className="rounded-lg border border-border-subtle bg-surface p-4">
        <p role="status" className="flex items-center gap-2 text-xs text-foreground-muted">
          <span aria-hidden="true" className="flex items-center gap-0.5">
            <span className="animate-chat-dot size-1.5 rounded-full bg-foreground-muted [animation-delay:-0.3s] motion-reduce:animate-none" />
            <span className="animate-chat-dot size-1.5 rounded-full bg-foreground-muted [animation-delay:-0.15s] motion-reduce:animate-none" />
            <span className="animate-chat-dot size-1.5 rounded-full bg-foreground-muted motion-reduce:animate-none" />
          </span>
          {phase === 'waiting'
            ? t('conversation.waitingForModel', 'Waiting for the model…')
            : t('conversation.thinking', 'Thinking…')}{' '}
          <span className="tabular-nums">{t('conversation.elapsedSeconds', { seconds })}</span>
        </p>
      </div>
    </div>
  );
}
