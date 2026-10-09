import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, Shield01Icon, ChartHistogramIcon } from '@hugeicons/core-free-icons';

export interface ComposeStatusStripProps {
  scopeFolder?: string | null;
  scopePolicy?: 'standing-approval' | 'always-ask' | null;
  usedTokens?: number | null;
  maxTokens?: number | null;
  sessionSpend?: string | null;
  spendCap?: string | null;
  className?: string;
}

export function ComposeStatusStrip({
  scopeFolder = null,
  scopePolicy = null,
  usedTokens = null,
  maxTokens = null,
  sessionSpend = null,
  spendCap = null,
  className = '',
}: ComposeStatusStripProps) {
  const { t } = useTranslation();
  const unknown = t('compose.telemetryUnknown', 'Unknown');

  const hasTokens = usedTokens !== null && maxTokens !== null && maxTokens > 0;
  const tokenPercentage = hasTokens ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0;
  const hasSpend = sessionSpend !== null && spendCap !== null;

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
          title={
            scopeFolder === null
              ? t('compose.scopeUnknown', 'No project directory reported by the backend')
              : `Active project directory: ${scopeFolder}`
          }
        >
          <HugeiconsIcon icon={Folder01Icon} className="size-3 text-foreground-muted" />
          <span className="font-medium text-foreground">{scopeFolder ?? unknown}</span>
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
              : scopePolicy === 'always-ask'
                ? 'Agent prompts for approval before every write or command'
                : t('compose.policyUnknown', 'No approval policy reported by the backend')
          }
        >
          <HugeiconsIcon icon={Shield01Icon} className="size-3" />
          <span>
            {scopePolicy === 'standing-approval'
              ? t('compose.standingApproval', 'Standing Approval')
              : scopePolicy === 'always-ask'
                ? t('compose.alwaysAsk', 'Always Ask')
                : unknown}
          </span>
        </div>
      </div>

      {/* Trailing: Context Meter & Session Spend */}
      <div className="flex items-center gap-3">
        {/* Context / Token Meter */}
        <div
          className="flex items-center gap-1.5"
          title={
            hasTokens
              ? `Used ${usedTokens.toLocaleString()} of ${maxTokens.toLocaleString()} tokens (${tokenPercentage}%)`
              : t('compose.tokensUnknown', 'No token usage reported by the backend')
          }
        >
          <HugeiconsIcon icon={ChartHistogramIcon} className="size-3 text-foreground-muted" />
          {hasTokens ? (
            <>
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
            </>
          ) : (
            <span>{unknown}</span>
          )}
        </div>

        {/* Spend and Cap */}
        <div
          className="flex items-center gap-1 text-[10px] text-foreground-muted"
          title={
            hasSpend
              ? `Current session cost: ${sessionSpend} of ${spendCap} cap`
              : t('compose.budgetUnknown', 'No budget usage reported by the backend')
          }
        >
          <span>Budget:</span>
          <span className="font-medium text-foreground">{sessionSpend ?? unknown}</span>
          <span>/</span>
          <span>{spendCap ?? unknown}</span>
        </div>
      </div>
    </div>
  );
}
