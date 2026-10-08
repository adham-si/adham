import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Tick01Icon, Cancel01Icon, ViewIcon } from '@hugeicons/core-free-icons';

export interface ComposeApprovalBarProps {
  actionSummary: string;
  onApprove: () => void;
  onDeny: () => void;
  onReviewDiff?: (() => void) | undefined;
  riskLevel?: ('low' | 'medium' | 'high') | undefined;
  className?: string | undefined;
}

export function ComposeApprovalBar({
  actionSummary,
  onApprove,
  onDeny,
  onReviewDiff,
  riskLevel = 'medium',
  className = '',
}: ComposeApprovalBarProps) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs animate-in slide-in-from-bottom-1 duration-150 ${className}`}
    >
      {/* Action Description */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/20 text-warning">
          <HugeiconsIcon icon={Alert02Icon} className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <span>{t('compose.approvalRequired', 'Approval Required')}</span>
            <span
              className={`rounded px-1 text-[9px] uppercase font-semibold ${
                riskLevel === 'high'
                  ? 'bg-danger/20 text-danger'
                  : riskLevel === 'medium'
                    ? 'bg-warning/20 text-warning'
                    : 'bg-surface-subtle text-foreground-secondary'
              }`}
            >
              {riskLevel} risk
            </span>
          </div>
          <p className="truncate text-foreground-secondary text-[11px] font-mono mt-0.5">
            {actionSummary}
          </p>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        {onReviewDiff && (
          <button
            type="button"
            onClick={onReviewDiff}
            className="flex min-h-6 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          >
            <HugeiconsIcon icon={ViewIcon} className="size-3 text-foreground-muted" />
            <span>{t('compose.reviewDiff', 'Review')}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onDeny}
          className="flex min-h-6 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
          <span>{t('compose.deny', 'Deny')}</span>
        </button>

        <button
          type="button"
          onClick={onApprove}
          className="flex min-h-6 items-center gap-1 rounded-md bg-action px-2.5 text-[11px] font-medium text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <HugeiconsIcon icon={Tick01Icon} className="size-3" />
          <span>{t('compose.approve', 'Approve')}</span>
        </button>
      </div>
    </div>
  );
}
