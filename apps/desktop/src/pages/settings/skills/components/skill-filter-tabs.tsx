import * as React from 'react';

export type SkillFilterTab = 'all' | 'active' | 'available';

interface SkillFilterTabsProps {
  activeTab: SkillFilterTab;
  onTabChange: (tab: SkillFilterTab) => void;
  counts: {
    all: number;
    active: number;
    available: number;
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

export function SkillFilterTabs({ activeTab, onTabChange, counts }: SkillFilterTabsProps) {
  const tabs: Array<{ id: SkillFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All skills', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'available', label: 'Available', count: counts.available },
  ];

  return (
    <div role="tablist" aria-label="Skill filters" className="flex items-center gap-2">
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
