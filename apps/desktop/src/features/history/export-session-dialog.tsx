import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportSessionResponse } from '@adham/contracts-generated';
import { Button, DialogContent, DialogDescription, DialogRoot, DialogTitle, Input } from '@adham/ui';

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
  const [result, setResult] = React.useState<ExportSessionResponse | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setResult(null);
    setCopied(false);
    setCopyFailed(false);
  }, [open, sessionTitle]);

  if (!open) return null;

  const runExport = async () => {
    setCopied(false);
    setCopyFailed(false);
    const exported = await onExport();
    if (exported) setResult(exported);
  };

  const copyPath = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.path);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <DialogRoot open onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}>
      <DialogContent>
        <DialogTitle>
          {t('conversation.sessionActions.exportTitle', 'Export session')}
        </DialogTitle>
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
          <p className="text-xs text-foreground-muted">
            {t(
              'conversation.sessionActions.exportFixedFolder',
              "The file is written to the app's fixed exports folder. There is no Save As dialog in this build.",
            )}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {result ? (
            <div className="flex flex-col gap-2 rounded border border-border p-3">
              <label className="text-xs font-medium text-foreground-muted" htmlFor="export-path">
                {t('conversation.sessionActions.exportPathLabel', 'File path')}
              </label>
              <div className="flex gap-2">
                <Input id="export-path" readOnly value={result.path} className="min-w-0 flex-1" />
                <Button type="button" variant="secondary" size="sm" onClick={() => void copyPath()}>
                  {copied
                    ? t('conversation.sessionActions.copied', 'Copied')
                    : t('conversation.sessionActions.copyPath', 'Copy path')}
                </Button>
              </div>
              <p className="text-xs text-foreground-muted">
                {t('conversation.sessionActions.exportBytes', {
                  bytes: result.bytes.toLocaleString(),
                  defaultValue: `${result.bytes.toLocaleString()} bytes`,
                })}
              </p>
              <span aria-live="polite" className="text-xs text-foreground-muted">
                {copyFailed
                  ? t('conversation.sessionActions.copyFailed', 'Could not copy the path.')
                  : ''}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {result
              ? t('conversation.sessionActions.close', 'Close')
              : t('conversation.sessionActions.cancel', 'Cancel')}
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
