import * as React from 'react';

export type ModelFilterTab = 'all' | 'local' | 'cloud';

interface ModelFilterTabsProps {
  activeTab: ModelFilterTab;
  onTabChange: (tab: ModelFilterTab) => void;
  counts: {
    all: number;
    local: number;
    cloud: number;
  };
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

export function ModelFilterTabs({ activeTab, onTabChange, counts }: ModelFilterTabsProps) {
  const tabs: Array<{ id: ModelFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All models', count: counts.all },
    { id: 'local', label: 'Local models', count: counts.local },
    { id: 'cloud', label: 'Cloud models', count: counts.cloud },
  ];

  return (
    <div role="tablist" aria-label="Model filters" className="flex items-center gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`min-h-control-sm rounded-md px-3 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === tab.id
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          <span>{tab.label}</span>
          <MetricBadge count={tab.count} isActive={activeTab === tab.id} />
        </button>
      ))}
    </div>
  );
}
