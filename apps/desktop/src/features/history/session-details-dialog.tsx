import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
} from '@adham/ui';

export interface SessionDetailsDialogProps {
  open: boolean;
  initialTitle: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}

/** Title-only until the summary field arrives in Task 5. */
export function SessionDetailsDialog({
  open,
  initialTitle,
  busy,
  error,
  onClose,
  onSave,
}: SessionDetailsDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState(initialTitle);
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setLocalError(null);
  }, [open, initialTitle]);

  if (!open) return null;

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
            'conversation.sessionActions.renameDescription',
            'Rename this session. The new title is saved locally.',
          )}
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3">
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
