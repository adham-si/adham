import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportSessionResponse } from '@adham/contracts-generated';
import { AdhamIcon, Button } from '@adham/ui';

export interface ExportSessionToastProps {
  result: ExportSessionResponse | null;
  onClose: () => void;
}

export function ExportSessionToast({ result, onClose }: ExportSessionToastProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);

  React.useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [result]);

  if (!result) return null;

  const copyPath = async () => {
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
    <div
      role="status"
      className="fixed end-4 bottom-4 z-toast w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-border-subtle bg-surface-raised p-3.5 shadow-floating"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-surface text-success-foreground">
          <AdhamIcon size="sm">
            <path d="M20 6 9 17l-5-5" />
          </AdhamIcon>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t('conversation.sessionActions.exportSucceededTitle', 'Export complete')}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-foreground-secondary">
                {t(
                  'conversation.sessionActions.exportSucceeded',
                  'The file is saved outside Adham and will remain if you delete the session.',
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={t('conversation.sessionActions.close', 'Close')}
              onClick={onClose}
              className="-me-1 -mt-1"
            >
              <AdhamIcon size="sm">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </AdhamIcon>
            </Button>
          </div>
          <div className="mt-3 rounded-lg border border-border-subtle bg-surface-muted p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
                {t('conversation.sessionActions.exportPathLabel', 'File path')}
              </span>
              <span className="text-[11px] text-foreground-muted">
                {t('conversation.sessionActions.exportBytes', {
                  bytes: result.bytes.toLocaleString(),
                  defaultValue: `${result.bytes.toLocaleString()} bytes`,
                })}
              </span>
            </div>
            <p
              dir="ltr"
              className="mt-1 break-all font-mono text-xs leading-5 text-foreground-secondary"
            >
              {result.path}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span aria-live="polite" className="text-[11px] text-foreground-muted">
                {copyFailed
                  ? t('conversation.sessionActions.copyFailed', 'Could not copy the path.')
                  : ''}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void copyPath()}
                className="ms-auto"
              >
                <AdhamIcon size="sm">
                  <path d="M8 8h12v12H8z" />
                  <path d="M16 8V4H4v12h4" />
                </AdhamIcon>
                {copied
                  ? t('conversation.sessionActions.copied', 'Copied')
                  : t('conversation.sessionActions.copyPath', 'Copy path')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
