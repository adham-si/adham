import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { PendingOperationDto } from '@adham/contracts-generated';
import { Button } from '@adham/ui';

export interface PendingRecoveryBannerProps {
  operations: PendingOperationDto[];
  truncated: boolean;
  onReview: (op: PendingOperationDto) => void;
  onDismiss: (op: PendingOperationDto) => void;
}

export function PendingRecoveryBanner({
  operations,
  truncated,
  onReview,
  onDismiss,
}: PendingRecoveryBannerProps) {
  const { t } = useTranslation();

  if (operations.length === 0) return null;

  const topOp = operations[0];
  if (!topOp) return null;

  const targetLabel = topOp.title
    ? topOp.title
    : `${topOp.workspaceId} / ${topOp.projectId}${topOp.sessionId ? ` / ${topOp.sessionId}` : ''}`;

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-surface p-3 text-warning-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <p className="font-semibold text-sm">
            {t('conversation.recovery.bannerTitle', 'Unresolved message in {{target}}', {
              target: targetLabel,
            })}
          </p>
          <p className="text-xs opacity-90">
            {t(
              'conversation.recovery.bannerDescription',
              'A message had an unknown save status during a previous run.',
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onDismiss(topOp)}
            className="text-xs"
          >
            {t('conversation.recovery.dismissAction', 'Dismiss')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => onReview(topOp)} className="text-xs">
            {t('conversation.recovery.reviewAction', 'Review & Resend')}
          </Button>
        </div>
      </div>

      {truncated && (
        <p className="text-[11px] opacity-75">
          {t(
            'conversation.recovery.truncated',
            'Showing {{count}} unresolved messages. Older unresolved operations are truncated.',
            { count: operations.length },
          )}
        </p>
      )}
    </div>
  );
}
