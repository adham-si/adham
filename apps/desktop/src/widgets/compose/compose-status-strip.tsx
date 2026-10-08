import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, Shield01Icon, ChartHistogramIcon } from '@hugeicons/core-free-icons';

export interface ComposeStatusStripProps {
  scopeFolder?: string;
  scopePolicy?: 'standing-approval' | 'always-ask';
  usedTokens?: number;
  maxTokens?: number;
  sessionSpend?: string;
  spendCap?: string;
  className?: string;
}

export function ComposeStatusStrip({
  scopeFolder = 'adham.si',
  scopePolicy = 'always-ask',
  usedTokens = 12400,
  maxTokens = 128000,
  sessionSpend = '$0.00',
  spendCap = '$2.00',
  className = '',
}: ComposeStatusStripProps) {
  const { t } = useTranslation();

  const tokenPercentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100));

  return (
    <div
      role="region"
      aria-label="Agent governance and budget status"
      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1 text-[11px] text-foreground-secondary ${className}`}
    >
      {/* Leading: Scope and Permission Chip */}
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1 rounded bg-surface-subtle px-1.5 py-0.5 border border-border-subtle"
          title={`Active project directory: ${scopeFolder}`}
        >
          <HugeiconsIcon icon={Folder01Icon} className="size-3 text-foreground-muted" />
          <span className="font-medium text-foreground">{scopeFolder}</span>
        </div>

        <div
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] ${
            scopePolicy === 'standing-approval'
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-border-subtle bg-surface-subtle text-foreground-secondary'
          }`}
          title={
            scopePolicy === 'standing-approval'
              ? 'Agent may write files without per-action confirmation'
              : 'Agent prompts for approval before every write or command'
          }
        >
          <HugeiconsIcon icon={Shield01Icon} className="size-3" />
          <span>
            {scopePolicy === 'standing-approval'
              ? t('compose.standingApproval', 'Standing Approval')
              : t('compose.alwaysAsk', 'Always Ask')}
          </span>
        </div>
      </div>

      {/* Trailing: Context Meter & Session Spend */}
      <div className="flex items-center gap-3">
        {/* Context / Token Meter */}
        <div
          className="flex items-center gap-1.5"
          title={`Used ${usedTokens.toLocaleString()} of ${maxTokens.toLocaleString()} tokens (${tokenPercentage}%)`}
        >
          <HugeiconsIcon icon={ChartHistogramIcon} className="size-3 text-foreground-muted" />
          <span>
            {(usedTokens / 1000).toFixed(1)}k / {(maxTokens / 1000).toFixed(0)}k
          </span>
          <div className="h-1.5 w-12 rounded-full bg-surface-subtle overflow-hidden border border-border-subtle">
            <div
              className={`h-full rounded-full transition-all ${
                tokenPercentage > 85
                  ? 'bg-danger'
                  : tokenPercentage > 60
                    ? 'bg-warning'
                    : 'bg-action'
              }`}
              style={{ width: `${tokenPercentage}%` }}
            />
          </div>
        </div>

        {/* Spend and Cap */}
        <div
          className="flex items-center gap-1 text-[10px] text-foreground-muted"
          title={`Current session cost: ${sessionSpend} of ${spendCap} cap`}
        >
          <span>Budget:</span>
          <span className="font-medium text-foreground">{sessionSpend}</span>
          <span>/</span>
          <span>{spendCap}</span>
        </div>
      </div>
    </div>
  );
}
