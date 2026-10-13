import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/shared/i18n/format';

export type PluginFilterTab = 'all' | 'installed' | 'available';

interface PluginFilterTabsProps {
  activeTab: PluginFilterTab;
  onTabChange: (tab: PluginFilterTab) => void;
  counts: {
    all: number;
    installed: number;
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
      {formatNumber(count)}
    </span>
  );
}

export function PluginFilterTabs({ activeTab, onTabChange, counts }: PluginFilterTabsProps) {
  const { t } = useTranslation();
  const tabs: Array<{ id: PluginFilterTab; label: string; count: number }> = [
    { id: 'all', label: t('settings.plugins.allTab', 'All plugins'), count: counts.all },
    {
      id: 'installed',
      label: t('settings.plugins.installedTab', 'Installed'),
      count: counts.installed,
    },
    {
      id: 'available',
      label: t('settings.plugins.availableTab', 'Available'),
      count: counts.available,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label={t('settings.plugins.tabsLabel', 'Plugin filters')}
      className="flex items-center gap-2"
    >
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
