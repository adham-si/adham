import * as React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Live turn status while no answer text is on screen yet. "Waiting for the
 * model…" begins at dispatch; "Thinking…" appears only after real reasoning
 * activity from the provider — elapsed time is displayed next to the status
 * but never decides it.
 */
export function TurnStatus({
  phase,
  startedAt,
}: {
  phase: 'waiting' | 'thinking';
  startedAt: number;
}) {
  const { t } = useTranslation();
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return (
    <p role="status" className="px-1 text-xs text-foreground-muted">
      {phase === 'waiting'
        ? t('conversation.waitingForModel', 'Waiting for the model…')
        : t('conversation.thinking', 'Thinking…')}{' '}
      <span className="tabular-nums">{t('conversation.elapsedSeconds', { seconds })}</span>
    </p>
  );
}
