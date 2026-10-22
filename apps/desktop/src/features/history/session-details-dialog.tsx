import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
  Textarea,
} from '@adham/ui';

const SUMMARY_LIMIT = 500;

export interface SessionDetailsDialogProps {
  open: boolean;
  initialTitle: string;
  initialSummary: string | null;
  initialSummaryOrigin: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
  onSaveSummary: (summary: string | null) => Promise<void>;
}

export function SessionDetailsDialog({
  open,
  initialTitle,
  initialSummary,
  initialSummaryOrigin,
  busy,
  error,
  onClose,
  onSave,
  onSaveSummary,
}: SessionDetailsDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState(initialTitle);
  const [summary, setSummary] = React.useState(initialSummary ?? '');
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setSummary(initialSummary ?? '');
    setLocalError(null);
  }, [open, initialTitle, initialSummary, initialSummaryOrigin]);

  if (!open) return null;

  const trimmedSummary = summary.trim();
  const summaryCount = Array.from(trimmedSummary).length;
  const summaryTooLong = summaryCount > SUMMARY_LIMIT;
  const hasUserSummary = initialSummaryOrigin === 'user';
  const originLabel = hasUserSummary
    ? t('conversation.sessionActions.summaryUser', 'Custom summary')
    : t('conversation.sessionActions.summaryAuto', 'Auto summary');

  const handleOpenChange = (next: boolean) => {
    if (!next && !busy) onClose();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setLocalError(t('conversation.sessionActions.titleRequired', 'Enter a title.'));
      return;
    }
    setLocalError(null);
    void onSave(title);
  };

  const saveSummary = () => {
    if (busy || summaryTooLong) return;
    void onSaveSummary(trimmedSummary.length > 0 ? trimmedSummary : null);
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="sm"
        label={t('conversation.sessionActions.detailsTitle', 'Session details')}
      >
        <DialogTitle>
          {t('conversation.sessionActions.detailsTitle', 'Session details')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'conversation.sessionActions.detailsDescription',
            'Rename this session and edit the summary shown in history.',
          )}
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {t('conversation.sessionActions.titleLabel', 'Title')}
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                aria-invalid={localError !== null || error !== null}
                disabled={busy}
              />
            </label>
            {(localError ?? error) ? (
              <p role="alert" className="text-sm text-danger-foreground">
                {localError ?? error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="session-summary" className="text-sm font-medium">
                {t('conversation.sessionActions.summaryLabel', 'Summary')}
              </label>
              <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] text-foreground-muted">
                {originLabel}
              </span>
            </div>
            <p className="text-xs text-foreground-muted">
              {t(
                'conversation.sessionActions.summaryDescription',
                'Leave blank to use the auto summary.',
              )}
            </p>
            <Textarea
              id="session-summary"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={busy}
              {...(summaryTooLong
                ? {
                    invalid: true,
                    errorMessage: t(
                      'error.validation.summary_too_long',
                      'The summary must be 500 characters or fewer.',
                    ),
                  }
                : {})}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span aria-live="polite" className="text-xs text-foreground-muted">
                {summaryCount} / {SUMMARY_LIMIT}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSummary('');
                    void onSaveSummary(null);
                  }}
                  disabled={busy || !hasUserSummary}
                >
                  {t('conversation.sessionActions.resetToAuto', 'Reset to auto')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={saveSummary}
                  disabled={busy || summaryTooLong}
                >
                  {t('conversation.sessionActions.saveSummary', 'Save summary')}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              {t('conversation.sessionActions.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={busy || title.trim().length === 0}>
              {busy
                ? t('conversation.sessionActions.saving', 'Saving…')
                : t('conversation.sessionActions.save', 'Save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
