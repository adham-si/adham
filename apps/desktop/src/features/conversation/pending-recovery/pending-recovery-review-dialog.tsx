import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  useClipboardCopy,
} from '@adham/ui';
import type { ReviewDialogProps } from './pending-recovery-types';

export function PendingRecoveryReviewDialog({
  open,
  operation,
  validatingTarget = false,
  targetMissing = false,
  targetLabel,
  initialDismissConfirm = false,
  onClose,
  onResend,
  onDismiss,
}: ReviewDialogProps) {
  const { t } = useTranslation();
  const { state: copyState, copy, reset: resetCopy } = useClipboardCopy();
  const [submitting, setSubmitting] = React.useState(false);
  const [dismissConfirmOpen, setDismissConfirmOpen] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      resetCopy();
      setSubmitting(false);
      setDismissConfirmOpen(false);
      setDialogError(null);
    } else {
      setDismissConfirmOpen(Boolean(initialDismissConfirm));
      setDialogError(null);
    }
  }, [open, initialDismissConfirm, resetCopy]);

  if (!operation) return null;

  const handleCopy = async () => {
    await copy(operation.text);
  };

  const handleResendClick = async () => {
    if (submitting) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const outcome = await onResend(operation);
      if (outcome && !outcome.ok) {
        setDialogError(outcome.error ?? t('conversation.recovery.resendFailed', 'Resend failed.'));
        return;
      }
      onClose();
    } catch (err) {
      setDialogError(
        err instanceof Error
          ? err.message
          : t('conversation.recovery.resendFailed', 'Resend failed.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismissConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const outcome = await onDismiss(operation);
      if (outcome && !outcome.ok) {
        setDialogError(
          outcome.error ?? t('conversation.recovery.dismissFailed', 'Dismissal failed.'),
        );
        return;
      }
      onClose();
    } catch (err) {
      setDialogError(
        err instanceof Error
          ? err.message
          : t('conversation.recovery.dismissFailed', 'Dismissal failed.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismissCancel = () => {
    setDialogError(null);
    if (initialDismissConfirm) {
      onClose();
    } else {
      setDismissConfirmOpen(false);
    }
  };

  const displayTarget =
    targetLabel ??
    `${operation.workspaceId} / ${operation.projectId}${
      operation.sessionId ? ` / ${operation.sessionId}` : ''
    }`;

  return (
    <DialogRoot open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        {dismissConfirmOpen ? (
          <div>
            <DialogTitle>
              {t('conversation.recovery.dismissWarningTitle', 'Dismiss unresolved message?')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'conversation.recovery.dismissWarning',
                'Dismissing will remove this recovery reminder. If the server already committed this message, it will remain in history; if not, this draft will not be sent.',
              )}
            </DialogDescription>

            {dialogError && (
              <div
                role="alert"
                className="my-3 rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {dialogError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" disabled={submitting} onClick={handleDismissCancel}>
                {t('conversation.recovery.cancelDismiss', 'Cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={submitting}
                onClick={() => void handleDismissConfirm()}
              >
                {t('conversation.recovery.confirmDismiss', 'Dismiss Reminder')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <DialogTitle>
              {t('conversation.recovery.modalTitle', 'Unresolved Message Recovery')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'conversation.recovery.bannerDescription',
                'A message had an unknown save status during a previous run.',
              )}
            </DialogDescription>

            {dialogError && (
              <div
                role="alert"
                className="my-3 rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {dialogError}
              </div>
            )}

            <div className="my-4 space-y-3 text-sm">
              <div>
                <span className="font-semibold text-foreground">
                  {t('conversation.recovery.targetLabel', 'Original Target')}:
                </span>{' '}
                <span className="font-mono text-xs text-foreground-secondary">{displayTarget}</span>
              </div>

              {validatingTarget ? (
                <div
                  role="status"
                  className="rounded border border-border bg-surface-muted p-2 text-xs text-foreground-secondary"
                >
                  {t('conversation.recovery.checkingTarget', 'Checking target availability…')}
                </div>
              ) : targetMissing ? (
                <div
                  role="alert"
                  className="rounded border border-warning-border bg-warning-surface p-2 text-xs text-warning-foreground"
                >
                  {t(
                    'conversation.recovery.targetMissing',
                    'Target workspace or project is inaccessible or missing.',
                  )}
                </div>
              ) : null}

              {operation.title && (
                <div>
                  <span className="font-semibold text-foreground">
                    {t('conversation.recovery.titlePreview', 'Session Title')}:
                  </span>{' '}
                  <span className="text-foreground-secondary">{operation.title}</span>
                </div>
              )}

              <div>
                <span className="font-semibold text-foreground">
                  {t('conversation.recovery.messagePreview', 'Message Content')}:
                </span>
                <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-muted p-2 text-xs font-mono">
                  {operation.text}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
                  {t('conversation.recovery.copyText', 'Copy Text')}
                </Button>
                <span role="status" className="self-center text-xs text-foreground-muted">
                  {copyState === 'copied'
                    ? t('conversation.recovery.textCopied', 'Copied to clipboard')
                    : copyState === 'failed'
                      ? t('conversation.recovery.copyFailed', 'Copy failed')
                      : ''}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setDismissConfirmOpen(true)}
                >
                  {t('conversation.recovery.dismissAction', 'Dismiss')}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" disabled={submitting} onClick={onClose}>
                  {t('conversation.recovery.cancelDismiss', 'Cancel')}
                </Button>
                {!targetMissing && (
                  <Button
                    variant="primary"
                    disabled={submitting || validatingTarget}
                    onClick={() => void handleResendClick()}
                  >
                    {t('conversation.recovery.confirmResend', 'Resend to Original Target')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}
