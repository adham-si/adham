import { useTranslation } from 'react-i18next';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChartHistogramIcon } from '@hugeicons/core-free-icons';

export interface ComposeStatusStripProps {
  /** Model maximum context in tokens, when evidenced by the provider. */
  contextLimit?: number | null;
  /** Effective request budget (model max ∩ endpoint-configured), when evidenced. */
  effectiveContextBudget?: number | null;
  className?: string;
}

/** Compact token count for the strip: 512, 8k, 131k. */
function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : `${tokens}`;
}

/**
 * Context status for the composer. Only evidenced values render: no folder,
 * policy, spend or usage chip has a backend source yet, and an absent value
 * must not degrade into an "Unknown" dashboard — with no evidence the strip
 * renders nothing at all.
 */
export function ComposeStatusStrip({
  contextLimit = null,
  effectiveContextBudget = null,
  className = '',
}: ComposeStatusStripProps) {
  const { t } = useTranslation();

  const budgetKnown = effectiveContextBudget !== null && effectiveContextBudget > 0;
  const tokens = budgetKnown ? effectiveContextBudget : contextLimit;
  if (tokens === null || tokens <= 0) return null;

  // Label plus number composed in TS: the number is not a translated segment,
  // and the unit suffix stays locale-neutral (k = thousand).
  const label = budgetKnown
    ? t('compose.contextBudget', 'Context budget')
    : t('compose.modelContext', 'Model context');

  return (
    <div
      role="region"
      aria-label={t('compose.statusRegion', 'Agent governance and budget status')}
      className={`flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-foreground-secondary ${className}`}
    >
      <div
        className="flex items-center gap-2"
        title={
          budgetKnown
            ? t(
                'compose.contextBudgetTitle',
                'Request budget evidenced by the model maximum and the endpoint-configured context',
              )
            : t(
                'compose.modelContextTitle',
                'Model maximum reported by the endpoint; the effective request budget is not reported',
              )
        }
      >
        <HugeiconsIcon icon={ChartHistogramIcon} className="size-4 text-foreground-muted" />
        <span>{`${label}: ${formatTokens(tokens)}`}</span>
      </div>
    </div>
  );
}
