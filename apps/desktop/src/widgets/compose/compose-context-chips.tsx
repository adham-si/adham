import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/shared/i18n/format';
import { HugeiconsIcon } from '@hugeicons/react';
import { DocumentCodeIcon, Cancel01Icon } from '@hugeicons/core-free-icons';

/** One composer file selection as the chip renders it. `reading`/`pending` are
 *  states, not types: nothing is claimed ready until the backend stored it. */
export interface ComposeAttachmentChip {
  key: string;
  fileName: string;
  byteSize?: number | undefined;
  charCount?: number | undefined;
  status: 'reading' | 'ready' | 'pending' | 'error';
  truncated?: boolean | undefined;
  /** Refusal code shown to the user; never guessed by the UI. */
  errorCode?: string | undefined;
}

export interface ComposeContextChipsProps {
  attachments: ComposeAttachmentChip[];
  onRemove: (key: string) => void;
  className?: string | undefined;
}

// Byte units stay symbolic (B/KB/MB everywhere); only the numerals follow
// the app language. Near the 1024-boundary grouping may differ from the old
// toFixed rendering by a thousands separator; accepted for correct locales.
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024)
    return `${formatNumber(bytes / 1024, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(bytes / (1024 * 1024), undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export function ComposeContextChips({
  attachments,
  onRemove,
  className = '',
}: ComposeContextChipsProps) {
  const { t } = useTranslation();
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      role="list"
      aria-label={t('compose.attachedContext')}
      className={`flex flex-wrap items-center gap-2 px-4 pt-3 pb-1 ${className}`}
    >
      {attachments.map((item) => (
        <div
          key={item.key}
          role="listitem"
          className={`group flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors ${
            item.status === 'error'
              ? 'border-danger/40 bg-danger/5 text-foreground'
              : 'border-border-subtle bg-surface-subtle text-foreground hover:border-border'
          }`}
        >
          <span className="text-foreground-secondary [&_svg]:size-4">
            <HugeiconsIcon icon={DocumentCodeIcon} />
          </span>

          <span className="max-w-44 truncate font-medium" title={item.fileName}>
            {item.fileName}
          </span>

          {item.status === 'error' ? (
            <span role="alert" className="text-xs text-danger-foreground">
              {t(`attachments.errors.${item.errorCode ?? 'unknown'}`)}
            </span>
          ) : item.status === 'reading' ? (
            <span className="text-xs text-foreground-muted">{t('attachments.reading')}</span>
          ) : item.status === 'pending' ? (
            <span className="text-xs text-foreground-muted" title={t('attachments.pendingTitle')}>
              {t('attachments.pendingRead')}
            </span>
          ) : (
            <>
              {item.charCount !== undefined ? (
                <span className="text-xs text-foreground-muted">
                  {t('compose.charsCompact', {
                    count: item.charCount,
                    formatted: formatNumber(item.charCount / 1000, undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }),
                  })}
                </span>
              ) : item.byteSize ? (
                <span className="text-xs text-foreground-muted">{formatBytes(item.byteSize)}</span>
              ) : null}
              {item.truncated && (
                <span className="rounded-sm border border-border-subtle px-1 text-xs text-foreground-muted">
                  {t('attachments.truncated')}
                </span>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={t('compose.removeAttachment', { name: item.fileName })}
            title={t('compose.removeAttachment', { name: item.fileName })}
            className="ms-1 flex size-4 items-center justify-center rounded-sm text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-3"
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </button>
        </div>
      ))}
    </div>
  );
}
