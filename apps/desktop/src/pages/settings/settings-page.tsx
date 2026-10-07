import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarItem } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Search01Icon,
  PreferenceHorizontalIcon,
  AiMagicIcon,
  AiArtIcon,
  Route01Icon,
  McpServerIcon,
  AiDrawingIcon,
  PuzzleIcon,
  BrickWallFireIcon,
  Coins01Icon,
  ChartAnalysisIcon,
  ServerStack03Icon,
  CircleQuestionMarkIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import { useShellLayout, type SettingsPageId } from '@/widgets/shell/layout-context';
import { PreferencesPage } from './preferences';
import { ModelsPage } from './models';
import { ProvidersPage } from './providers';
import { RoutingPage } from './routing';
import { McpPage } from './mcp';
import { SkillsPage } from './skills';
import { PluginsPage } from './plugins';
import { GovernancePage } from './governance';
import { BudgetPage } from './budget';
import { UsagePage } from './usage';
import { DataPage } from './data';
import { InfoPage } from './info';

export function SettingsPage() {
  const { t } = useTranslation();
  const { settingsOpen, closeSettings, activeSettingsPage, setActiveSettingsPage } =
    useShellLayout();
  const [searchQuery, setSearchQuery] = React.useState('');

  // Close on Escape key
  React.useEffect(() => {
    if (!settingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  const categories: Array<{
    name: string;
    pages: Array<{ id: SettingsPageId; label: string; icon: React.ReactNode }>;
  }> = [
    {
      name: 'Personal',
      pages: [
        {
          id: 'preferences',
          label: 'Preferences',
          icon: <HugeiconsIcon icon={PreferenceHorizontalIcon} />,
        },
      ],
    },
    {
      name: 'Intelligence',
      pages: [
        {
          id: 'models',
          label: 'AI Models',
          icon: <HugeiconsIcon icon={AiMagicIcon} />,
        },
        {
          id: 'providers',
          label: 'AI Providers',
          icon: <HugeiconsIcon icon={AiArtIcon} />,
        },
        {
          id: 'routing',
          label: 'Routing',
          icon: <HugeiconsIcon icon={Route01Icon} />,
        },
      ],
    },
    {
      name: 'Extensions',
      pages: [
        {
          id: 'mcp',
          label: 'MCP',
          icon: <HugeiconsIcon icon={McpServerIcon} />,
        },
        {
          id: 'skills',
          label: 'Skills',
          icon: <HugeiconsIcon icon={AiDrawingIcon} />,
        },
        {
          id: 'plugins',
          label: 'Plugins',
          icon: <HugeiconsIcon icon={PuzzleIcon} />,
        },
      ],
    },
    {
      name: 'Operations & Policy',
      pages: [
        {
          id: 'security',
          label: 'Security',
          icon: <HugeiconsIcon icon={BrickWallFireIcon} />,
        },
        {
          id: 'budget',
          label: 'Budget',
          icon: <HugeiconsIcon icon={Coins01Icon} />,
        },
        {
          id: 'usage',
          label: 'Usage',
          icon: <HugeiconsIcon icon={ChartAnalysisIcon} />,
        },
      ],
    },
    {
      name: 'System',
      pages: [
        {
          id: 'data',
          label: 'Data',
          icon: <HugeiconsIcon icon={ServerStack03Icon} />,
        },
        {
          id: 'info',
          label: 'About',
          icon: <HugeiconsIcon icon={CircleQuestionMarkIcon} />,
        },
      ],
    },
  ];

  const filteredCategories = categories
    .map((cat) => ({
      ...cat,
      pages: cat.pages.filter((page) =>
        page.label.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    }))
    .filter((cat) => cat.pages.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      className="fixed inset-0 z-dialog flex items-center justify-center p-4 sm:p-6 md:p-8"
    >
      {/* Scrim backdrop */}
      <div onClick={closeSettings} className="absolute inset-0 bg-scrim" />

      {/* Centered Modal Frame */}
      <div className="relative flex flex-col md:flex-row w-full max-w-5xl xl:max-w-6xl h-[85vh] max-h-[880px] min-h-[580px] rounded-xl border border-border bg-surface-raised shadow-floating overflow-hidden">
        {/* Left Settings Pages Navigation (272px) */}
        <aside
          aria-label="Settings Categories"
          className="flex w-full md:w-[272px] shrink-0 flex-col border-e border-border-subtle bg-surface-subtle p-3 select-none"
        >
          {/* Search Header without title */}
          <div className="mb-3">
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings.search')}
                className="w-full min-h-control-md rounded-md border border-border-subtle bg-surface ps-9 pe-3 text-sm text-foreground placeholder:text-foreground-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              <span className="pointer-events-none absolute start-3 flex items-center justify-center text-foreground-muted [&_svg]:size-icon-sm">
                <HugeiconsIcon icon={Search01Icon} />
              </span>
            </div>
          </div>

          {/* Grouped Settings Pages List */}
          <div className="flex-1 space-y-3 overflow-y-auto pe-1">
            {filteredCategories.map((cat) => (
              <div key={cat.name} className="space-y-1">
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  {cat.name}
                </div>
                {cat.pages.map((page) => (
                  <SidebarItem
                    key={page.id}
                    selected={activeSettingsPage === page.id}
                    onClick={() => setActiveSettingsPage(page.id)}
                    className="w-full justify-start [&_svg]:size-icon-sm [&_svg]:shrink-0"
                  >
                    {page.icon}
                    <span className="truncate">{page.label}</span>
                  </SidebarItem>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Right Settings Page Content Pane */}
        <main className="relative flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
          {/* Active Settings Page View */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 pe-12">
            {activeSettingsPage === 'preferences' && <PreferencesPage />}
            {activeSettingsPage === 'models' && <ModelsPage />}
            {activeSettingsPage === 'providers' && <ProvidersPage />}
            {activeSettingsPage === 'routing' && <RoutingPage />}
            {activeSettingsPage === 'mcp' && <McpPage />}
            {activeSettingsPage === 'skills' && <SkillsPage />}
            {activeSettingsPage === 'plugins' && <PluginsPage />}
            {(activeSettingsPage === 'security' || activeSettingsPage === 'governance') && (
              <GovernancePage />
            )}
            {activeSettingsPage === 'budget' && <BudgetPage />}
            {activeSettingsPage === 'usage' && <UsagePage />}
            {activeSettingsPage === 'data' && <DataPage />}
            {activeSettingsPage === 'info' && <InfoPage />}
          </div>

          {/* Top Close Button (floated at top-end, no separator bar, natural DOM stacking) */}
          <div className="absolute top-3 end-3">
            <button
              type="button"
              onClick={closeSettings}
              aria-label={t('settings.close')}
              className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-icon-sm"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
