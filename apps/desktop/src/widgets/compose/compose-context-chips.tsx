import { useTranslation } from 'react-i18next';
import * as React from 'react';
import { formatNumber } from '@/shared/i18n/format';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  File01Icon,
  Image01Icon,
  Folder01Icon,
  Cancel01Icon,
  DocumentCodeIcon,
} from '@hugeicons/core-free-icons';

export interface ComposeAttachment {
  id: string;
  type: 'file' | 'image' | 'folder' | 'pasted-text';
  name: string;
  size?: number; // bytes
  charCount?: number;
  preview?: string;
  file?: File;
}

export interface ComposeContextChipsProps {
  attachments: ComposeAttachment[];
  onRemove: (id: string) => void;
  className?: string;
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
      className={`flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1 ${className}`}
    >
      {attachments.map((item) => {
        let IconComponent = File01Icon;
        if (item.type === 'image') IconComponent = Image01Icon;
        if (item.type === 'folder') IconComponent = Folder01Icon;
        if (item.type === 'pasted-text') IconComponent = DocumentCodeIcon;

        return (
          <div
            key={item.id}
            role="listitem"
            className="group flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground transition-colors hover:border-border"
          >
            <span className="text-foreground-secondary [&_svg]:size-3.5">
              <HugeiconsIcon icon={IconComponent} />
            </span>

            <span className="max-w-44 truncate font-medium" title={item.name}>
              {item.name}
            </span>

            {item.size ? (
              <span className="text-[10px] text-foreground-muted">{formatBytes(item.size)}</span>
            ) : item.charCount ? (
              <span className="text-[10px] text-foreground-muted">
                {t('compose.charsCompact', {
                  count: item.charCount,
                  formatted: formatNumber(item.charCount / 1000, undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                })}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={t('compose.removeAttachment', { name: item.name })}
              title={t('compose.removeAttachment', { name: item.name })}
              className="ms-1 flex size-4 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&_svg]:size-3"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
