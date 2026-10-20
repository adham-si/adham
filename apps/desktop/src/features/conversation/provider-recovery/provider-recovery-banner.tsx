import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { PendingOperationDto } from '@adham/contracts-generated';
import { Button, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@adham/ui';
import type { MarkInterruptedResult } from './use-provider-recovery';

export interface ProviderRecoveryBannerProps {
  operations: PendingOperationDto[];
  error: string | null;
  busyOperationId: string | null;
  onRetry: () => void;
  onMarkInterrupted: (op: PendingOperationDto) => Promise<MarkInterruptedResult>;
}

function formatStarted(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Recovery surface for stale provider operations. Distinct from message
 * recovery: there is no resend (that would duplicate the user prompt) and no
 * dismiss (the op must resolve to an honest terminal). The confirm step is the
 * explicit authority to close the recorded operation.
 */
export function ProviderRecoveryBanner({
  operations,
  error,
  busyOperationId,
  onRetry,
  onMarkInterrupted,
}: ProviderRecoveryBannerProps) {
  const { t } = useTranslation();
  const [reviewing, setReviewing] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!reviewing) setDialogError(null);
  }, [reviewing]);

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-surface p-3 text-xs text-warning-foreground"
      >
        <span>{error}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('conversation.providerRecovery.retryAction', 'Retry')}
        </Button>
      </div>
    );
  }

  const op = operations[0];
  if (!op) return null;

  const target = `${op.workspaceId} / ${op.projectId}${op.sessionId ? ` / ${op.sessionId}` : ''}`;
  const busy = submitting || busyOperationId === op.operationId;

  const confirm = async () => {
    if (busy) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const result = await onMarkInterrupted(op);
      if (!result.ok) {
        setDialogError(result.error ?? t('conversation.providerRecovery.failed'));
        return;
      }
      setReviewing(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-surface p-3 text-warning-foreground shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">
              {t('conversation.providerRecovery.title', 'Unfinished generation')}
            </p>
            <p className="text-xs opacity-90">
              {t(
                'conversation.providerRecovery.description',
                'A generation from a previous run never produced a final result.',
              )}
            </p>
            <p className="font-mono text-[11px] break-all opacity-80">{target}</p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setReviewing(true)}
            className="text-xs"
          >
            {t('conversation.providerRecovery.reviewAction', 'Review')}
          </Button>
        </div>
        {operations.length > 1 && (
          <p className="text-[11px] opacity-75">
            {t(
              'conversation.providerRecovery.morePending',
              'Other unfinished operations will remain after this one.',
            )}
          </p>
        )}
      </div>

      <DialogRoot open={reviewing} onOpenChange={(next) => !next && !busy && setReviewing(false)}>
        <DialogContent size="md">
          <DialogTitle>
            {t('conversation.providerRecovery.dialogTitle', 'Mark this generation interrupted?')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'conversation.providerRecovery.dialogDescription',
              'The operation will be closed and the conversation will show a cancelled answer. The original prompt and operation record are kept.',
            )}
          </DialogDescription>

          <div className="my-4 space-y-2 text-sm">
            <div>
              <span className="font-semibold text-foreground">
                {t('conversation.providerRecovery.targetLabel', 'Conversation')}:
              </span>{' '}
              <span className="font-mono text-xs break-all text-foreground-secondary">
                {target}
              </span>
            </div>
            <div>
              <span className="font-semibold text-foreground">
                {t('conversation.providerRecovery.startedLabel', 'Started')}:
              </span>{' '}
              <span className="text-xs text-foreground-secondary">
                {formatStarted(op.createdAt)}
              </span>
            </div>
          </div>

          {dialogError && (
            <div
              role="alert"
              className="my-3 rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {dialogError}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setReviewing(false)}>
              {t('conversation.providerRecovery.cancelAction', 'Cancel')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {t('conversation.providerRecovery.confirmAction', 'Mark interrupted')}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
