import { useTranslation } from 'react-i18next';
import type { ExportSessionResponse } from '@adham/contracts-generated';
import { Button, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '@adham/ui';

export interface ExportSessionDialogProps {
  open: boolean;
  sessionTitle: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onExport: () => Promise<ExportSessionResponse | null>;
}

export function ExportSessionDialog({
  open,
  sessionTitle,
  busy,
  error,
  onClose,
  onExport,
}: ExportSessionDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const runExport = async () => {
    const exported = await onExport();
    if (exported) onClose();
  };

  return (
    <DialogRoot
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{t('conversation.sessionActions.exportTitle', 'Export session')}</DialogTitle>
        <DialogDescription>
          {t(
            'conversation.sessionActions.exportWarning',
            'This writes an unencrypted Markdown file that anyone with access to the folder can read. It is not deleted when you delete the session.',
          )}
        </DialogDescription>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">
            {t('conversation.sessionActions.exportSession', {
              title: sessionTitle,
              defaultValue: `Session: ${sessionTitle}`,
            })}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('conversation.sessionActions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void runExport()} disabled={busy}>
            {busy
              ? t('conversation.sessionActions.exporting', 'Exporting…')
              : t('conversation.sessionActions.exportAction', 'Export Markdown')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
