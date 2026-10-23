import { useTranslation } from 'react-i18next';
import { Button, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@adham/ui';

export interface DeleteSessionDialogProps {
  open: boolean;
  sessionTitle: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export function DeleteSessionDialog({
  open,
  sessionTitle,
  busy,
  error,
  onClose,
  onDelete,
}: DeleteSessionDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <DialogRoot
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {t('conversation.sessionActions.deleteTitle', 'Delete from history?')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'conversation.sessionActions.deleteCannotUndo',
            'This cannot be undone. The session disappears from history and its database content is deleted.',
          )}
        </DialogDescription>
        <div className="flex flex-col gap-3 text-sm text-foreground">
          <p>
            {t('conversation.sessionActions.deleteSession', {
              title: sessionTitle,
              defaultValue: `Session: ${sessionTitle}`,
            })}
          </p>
          <p className="text-foreground-muted">
            {t(
              'conversation.sessionActions.deleteMetadataRemains',
              'Event metadata remains for audit. This is not forensic erasure: storage-level copies such as SQLite journals or backups may remain.',
            )}
          </p>
          <p className="text-foreground-muted">
            {t(
              'conversation.sessionActions.deleteExportsRemain',
              'Markdown files you exported remain on disk and are not deleted with the session.',
            )}
          </p>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('conversation.sessionActions.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={() => void onDelete()} disabled={busy}>
            {busy
              ? t('conversation.sessionActions.deleting', 'Deleting…')
              : t('conversation.sessionActions.delete', 'Delete from history')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
