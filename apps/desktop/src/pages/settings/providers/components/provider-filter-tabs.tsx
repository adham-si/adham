import * as React from 'react';

export type ProviderFilterTab = 'all' | 'configured';

interface ProviderFilterTabsProps {
  activeTab: ProviderFilterTab;
  onTabChange: (tab: ProviderFilterTab) => void;
  configuredCount?: number;
  totalCount?: number;
}

function MetricBadge({ count, isActive }: { count: number; isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none border transition-colors ${
        isActive
          ? 'bg-brand text-action-foreground border-brand shadow-xs'
          : 'bg-brand/10 text-brand border-brand/30 dark:bg-brand/20 dark:text-brand dark:border-brand/40'
      }`}
    >
      {count}
    </span>
  );
}

export function ProviderFilterTabs({
  activeTab,
  onTabChange,
  configuredCount = 0,
  totalCount,
}: ProviderFilterTabsProps) {
  return (
    <div role="tablist" aria-label="Provider filters" className="flex items-center gap-2">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'all'}
        onClick={() => onTabChange('all')}
        className={`min-h-control-sm rounded-md px-3 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
          activeTab === 'all'
            ? 'bg-surface-muted text-foreground'
            : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
        }`}
      >
        <span>All providers</span>
        {totalCount !== undefined && totalCount > 0 && (
          <MetricBadge count={totalCount} isActive={activeTab === 'all'} />
        )}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'configured'}
        onClick={() => onTabChange('configured')}
        className={`min-h-control-sm rounded-md px-3 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
          activeTab === 'configured'
            ? 'bg-surface-muted text-foreground'
            : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
        }`}
      >
        <span>Configured</span>
        <MetricBadge count={configuredCount} isActive={activeTab === 'configured'} />
      </button>
    </div>
  );
}
