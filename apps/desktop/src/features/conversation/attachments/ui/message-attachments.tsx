import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { DocumentCodeIcon } from '@hugeicons/core-free-icons';
import type { AttachmentDto, MessageAttachmentDto } from '@adham/contracts-generated';
import { formatNumber } from '@/shared/i18n/format';
import { attachmentErrorCode } from '../api/attachment-client';

/** Cap for the inline preview: the stored text can be 200k characters, and a
 *  preview that states its own bound beats an unbounded DOM dump. */
const PREVIEW_DISPLAY_CHARS = 20_000;

export interface MessageAttachmentsProps {
  attachments: MessageAttachmentDto[];
  /** Reads the stored extracted text; absent hides the preview affordance. */
  readText?: ((attachmentId: string) => Promise<AttachmentDto>) | undefined;
  className?: string | undefined;
}

type PreviewState =
  | { state: 'loading' }
  | { state: 'ready'; text: string; total: number }
  | { state: 'error'; code: ReturnType<typeof attachmentErrorCode> };

/** The files a message was sent with, read from the stored link rows: a chip
 *  exists only because that turn carried the file. Preview shows the exact
 *  extracted text the model received, read back from storage. */
export function MessageAttachments({
  attachments,
  readText,
  className = '',
}: MessageAttachmentsProps) {
  const { t } = useTranslation();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewState | null>(null);

  if (attachments.length === 0) return null;

  const toggle = (attachmentId: string) => {
    if (openId === attachmentId) {
      setOpenId(null);
      setPreview(null);
      return;
    }
    setOpenId(attachmentId);
    if (!readText) return;
    setPreview({ state: 'loading' });
    void readText(attachmentId)
      .then((dto) => setPreview({ state: 'ready', text: dto.text, total: dto.text.length }))
      .catch((error) => setPreview({ state: 'error', code: attachmentErrorCode(error) }));
  };

  const open = attachments.find((item) => item.attachmentId === openId) ?? null;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <ul
        role="list"
        aria-label={t('attachments.sentLabel')}
        className="flex flex-wrap items-center gap-2"
      >
        {attachments.map((item) => (
          <li
            key={item.attachmentId}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground-secondary"
          >
            <HugeiconsIcon icon={DocumentCodeIcon} className="size-4 shrink-0" />
            <span className="max-w-44 truncate font-medium text-foreground" title={item.fileName}>
              {item.fileName}
            </span>
            <span className="text-xs text-foreground-muted">
              {t('compose.charsCompact', {
                count: item.extractedChars,
                formatted: formatNumber(item.extractedChars / 1000, undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
            {item.truncated && (
              <span className="rounded-sm border border-border-subtle px-1 text-xs text-foreground-muted">
                {t('attachments.truncated')}
              </span>
            )}
            <button
              type="button"
              onClick={() => toggle(item.attachmentId)}
              aria-expanded={openId === item.attachmentId}
              className="ms-1 rounded-sm px-1 text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              {openId === item.attachmentId
                ? t('attachments.previewHide')
                : t('attachments.previewShow')}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="rounded-md border border-border-subtle bg-surface-subtle p-2">
          {preview?.state === 'ready' ? (
            <>
              <pre
                dir="ltr"
                className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground"
              >
                {preview.text.slice(0, PREVIEW_DISPLAY_CHARS)}
              </pre>
              {preview.total > PREVIEW_DISPLAY_CHARS && (
                <p className="mt-1 text-xs text-foreground-muted">
                  {t('attachments.previewBound', {
                    shown: formatNumber(PREVIEW_DISPLAY_CHARS),
                    total: formatNumber(preview.total),
                  })}
                </p>
              )}
            </>
          ) : preview?.state === 'error' ? (
            <p className="text-xs text-foreground-muted">
              {t(`attachments.errors.${preview.code}`)}
            </p>
          ) : preview?.state === 'loading' ? (
            <p className="text-xs text-foreground-muted">{t('attachments.reading')}</p>
          ) : (
            <p className="text-xs text-foreground-muted">{t('attachments.previewUnavailable')}</p>
          )}
        </div>
      )}
    </div>
  );
}
