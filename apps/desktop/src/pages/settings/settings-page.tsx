import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarItem, AdhamIcon } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { useShellLayout, type SettingsPageId } from '@/widgets/shell/layout-context';
import { AppearancePage } from './appearance';
import { ModelsPage } from './models';
import { RoutingPage } from './routing';
import { McpPage } from './mcp';
import { SkillsPage } from './skills';
import { PluginsPage } from './plugins';
import { GovernancePage } from './governance';
import { BudgetPage } from './budget';
import { UsagePage } from './usage';
import { DataPage } from './data';
import { PrivacyPage } from './privacy';
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

  const categories = [
    {
      name: t('settings.categories.personal'),
      pages: [
        {
          id: 'appearance' as SettingsPageId,
          label: t('settings.tabs.appearance'),
          icon: (
            <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
          ),
        },
      ],
    },
    {
      name: t('settings.categories.intelligence'),
      pages: [
        {
          id: 'models' as SettingsPageId,
          label: t('settings.tabs.models'),
          icon: <path d="M12 2v20m10-10H2" />,
        },
        {
          id: 'routing' as SettingsPageId,
          label: 'Routing & Fallbacks',
          icon: <path d="M18 6L6 18M6 6l12 12" />,
        },
      ],
    },
    {
      name: t('settings.categories.extensions'),
      pages: [
        {
          id: 'mcp' as SettingsPageId,
          label: t('settings.extensions.mcp'),
          icon: <path d="M20 7h-9m9 5H7m13 5H4" />,
        },
        {
          id: 'skills' as SettingsPageId,
          label: t('settings.extensions.skills'),
          icon: (
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          ),
        },
        {
          id: 'plugins' as SettingsPageId,
          label: t('settings.extensions.plugins'),
          icon: (
            <path d="M16 16v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h1m11 7h2a2 2 0 002-2V6a2 2 0 00-2-2h-5a2 2 0 00-2 2v2" />
          ),
        },
      ],
    },
    {
      name: 'Governance & Operations',
      pages: [
        {
          id: 'governance' as SettingsPageId,
          label: 'Policies & Governance',
          icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
        },
        {
          id: 'budget' as SettingsPageId,
          label: 'Budget & Limits',
          icon: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />,
        },
        {
          id: 'usage' as SettingsPageId,
          label: 'Usage & Analytics',
          icon: <path d="M18 20V10M12 20V4M6 20v-6" />,
        },
      ],
    },
    {
      name: t('settings.categories.workspace'),
      pages: [
        {
          id: 'data' as SettingsPageId,
          label: t('settings.tabs.storage'),
          icon: (
            <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          ),
        },
        {
          id: 'privacy' as SettingsPageId,
          label: t('settings.tabs.privacy'),
          icon: <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />,
        },
        {
          id: 'info' as SettingsPageId,
          label: 'System Info & Diagnostics',
          icon: (
            <path d="M12 16v-4m0-4h.01M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z" />
          ),
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
      <div className="relative flex flex-col md:flex-row w-full max-w-5xl h-[720px] max-h-[88vh] rounded-xl border border-border bg-surface-raised shadow-floating overflow-hidden">
        {/* Left Settings Pages Navigation (272px) */}
        <aside
          aria-label="Settings Categories"
          className="flex w-full md:w-[272px] shrink-0 flex-col border-e border-border-subtle bg-surface-subtle p-3 select-none"
        >
          {/* Search Header */}
          <div className="mb-3">
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings.search')}
                className="w-full min-h-control-md rounded-md border border-border-subtle bg-surface ps-9 pe-3 text-sm text-foreground placeholder:text-foreground-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              <span className="pointer-events-none absolute start-3 flex items-center justify-center text-foreground-muted">
                <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.5} />
              </span>
            </div>
          </div>

          {/* Grouped Settings Pages List */}
          <div className="flex-1 space-y-3 overflow-y-auto pe-1">
            {filteredCategories.map((cat) => (
              <div key={cat.name} className="space-y-1">
                <div className="ps-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  {cat.name}
                </div>
                {cat.pages.map((page) => (
                  <SidebarItem
                    key={page.id}
                    selected={activeSettingsPage === page.id}
                    onClick={() => setActiveSettingsPage(page.id)}
                    className="w-full justify-start text-xs"
                  >
                    <AdhamIcon size="sm">{page.icon}</AdhamIcon>
                    <span className="truncate">{page.label}</span>
                  </SidebarItem>
                ))}
              </div>
            ))}
          </div>

          {/* Footer Info button */}
          <div
            onClick={() => setActiveSettingsPage('info')}
            className="cursor-pointer border-t border-border-subtle pt-2 text-[10px] text-foreground-muted hover:text-foreground transition-colors"
          >
            Adham Desktop • v0.1.0-alpha
          </div>
        </aside>

        {/* Right Settings Page Content Pane */}
        <main className="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
          {/* Top Close Bar */}
          <div className="flex items-center justify-end border-b border-border-subtle p-2">
            <button
              type="button"
              onClick={closeSettings}
              aria-label={t('settings.close')}
              className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <AdhamIcon size="sm">
                <path d="M18 6L6 18M6 6l12 12" />
              </AdhamIcon>
            </button>
          </div>

          {/* Active Settings Page View */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSettingsPage === 'appearance' && <AppearancePage />}
            {activeSettingsPage === 'models' && <ModelsPage />}
            {activeSettingsPage === 'routing' && <RoutingPage />}
            {activeSettingsPage === 'mcp' && <McpPage />}
            {activeSettingsPage === 'skills' && <SkillsPage />}
            {activeSettingsPage === 'plugins' && <PluginsPage />}
            {activeSettingsPage === 'governance' && <GovernancePage />}
            {activeSettingsPage === 'budget' && <BudgetPage />}
            {activeSettingsPage === 'usage' && <UsagePage />}
            {activeSettingsPage === 'data' && <DataPage />}
            {activeSettingsPage === 'privacy' && <PrivacyPage />}
            {activeSettingsPage === 'info' && <InfoPage />}
          </div>
        </main>
      </div>
    </div>
  );
}
