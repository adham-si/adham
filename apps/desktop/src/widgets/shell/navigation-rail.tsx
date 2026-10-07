import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { useTheme } from '@/theme/use-theme';
import { useShellLayout } from './layout-context';

export function NavigationRail() {
  const { t } = useTranslation();
  const { resolvedAppearance, setAppearance } = useTheme();
  const {
    sidebarOpen,
    toggleSidebar,
    focusMode,
    toggleFocusMode,
    activeRailDestination,
    setActiveRailDestination,
    openSettings,
  } = useShellLayout();

  const handleThemeCycle = () => {
    setAppearance(resolvedAppearance === 'dark' ? 'light' : 'dark');
  };

  const destinations = [
    {
      id: 'compose',
      label: t('rail.compose'),
      iconPath: (
        <>
          <path d="M12 4v16m8-8H4" />
        </>
      ),
    },
    {
      id: 'search',
      label: t('rail.search'),
      iconPath: (
        <>
          <path d="M21 21l-4.35-4.35" />
          <circle cx="11" cy="11" r="7" />
        </>
      ),
    },
    {
      id: 'projects',
      label: t('rail.projects'),
      iconPath: (
        <>
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </>
      ),
    },
    {
      id: 'agents',
      label: t('rail.agents'),
      iconPath: (
        <>
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6m3-3h-6" />
        </>
      ),
    },
    {
      id: 'activity',
      label: t('rail.activity'),
      iconPath: (
        <>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </>
      ),
    },
    {
      id: 'marketplace',
      label: t('rail.marketplace'),
      iconPath: (
        <>
          <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5" />
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="17" cy="19" r="1.5" />
        </>
      ),
    },
  ];

  return (
    <nav
      aria-label="Navigation Rail"
      className="flex w-10 shrink-0 flex-col items-center justify-between border-e border-border-subtle bg-surface-subtle py-2 select-none"
    >
      {/* Top: Sidebar Toggle & Brand */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('rail.toggleSidebar')}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </AdhamIcon>
        </button>

        <div className="my-1 h-px w-6 bg-border-subtle" />

        {/* Durable Destinations */}
        <div className="flex flex-col items-center gap-1">
          {destinations.map((dest) => {
            const isActive = activeRailDestination === dest.id;
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => setActiveRailDestination(dest.id)}
                aria-label={dest.label}
                aria-current={isActive ? 'page' : undefined}
                title={dest.label}
                className={`relative flex min-h-control-sm w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  isActive
                    ? 'bg-selection text-action'
                    : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                {isActive && (
                  <span className="absolute start-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-action" />
                )}
                <AdhamIcon size="sm" label={dest.label}>
                  {dest.iconPath}
                </AdhamIcon>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Actions: Focus Mode, Theme Toggle, Settings */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={toggleFocusMode}
          aria-label={t('rail.focusMode')}
          title={t('rail.focusMode')}
          className={`flex min-h-control-sm w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            focusMode
              ? 'bg-selection text-action'
              : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          <AdhamIcon size="sm" label={t('rail.focusMode')}>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </AdhamIcon>
        </button>

        <button
          type="button"
          onClick={handleThemeCycle}
          aria-label={t('rail.toggleTheme')}
          title={t('rail.toggleTheme')}
          className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('rail.toggleTheme')}>
            {resolvedAppearance === 'dark' ? (
              <circle cx="12" cy="12" r="5" />
            ) : (
              <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
            )}
          </AdhamIcon>
        </button>

        <button
          type="button"
          onClick={() => openSettings()}
          aria-label={t('rail.settings')}
          title={t('rail.settings')}
          className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('rail.settings')}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </AdhamIcon>
        </button>
      </div>
    </nav>
  );
}
