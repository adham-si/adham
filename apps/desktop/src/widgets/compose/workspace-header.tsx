import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { useShellLayout } from '../shell/layout-context';

export interface WorkspaceHeaderProps {
  workspaceName?: string | undefined;
  projectName?: string | undefined;
  sessionTitle?: string | undefined;
  isLoading?: boolean | undefined;
}

export function WorkspaceHeader({
  workspaceName = 'Workspace',
  projectName = 'Project',
  sessionTitle = 'Initial Session',
  isLoading = false,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();
  const {
    sidebarOpen,
    toggleSidebar,
    contextPanelOpen,
    toggleContextPanel,
    focusMode,
    toggleFocusMode,
  } = useShellLayout();

  return (
    <header className="flex min-h-control-md shrink-0 items-center justify-between border-b border-border-subtle bg-surface px-4 py-2 select-none">
      {/* Start: Navigation Affordances & Breadcrumbs */}
      <div className="flex items-center gap-2 overflow-hidden">
        {focusMode ? (
          <button
            type="button"
            onClick={toggleFocusMode}
            aria-label="Exit focus mode"
            className="flex min-h-control-sm items-center gap-1.5 rounded-md bg-selection px-2 text-xs font-medium text-action transition-colors hover:bg-selection"
          >
            <AdhamIcon size="sm" label="Exit focus">
              <path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 10H4m0 0V4m0 6l7-7m7 7h-6m0 0V4m0 6l7-7" />
            </AdhamIcon>
            <span>Exit Focus</span>
          </button>
        ) : (
          !sidebarOpen && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={t('sidebar.expand')}
              className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <AdhamIcon size="sm" label={t('sidebar.expand')}>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </AdhamIcon>
            </button>
          )
        )}

        <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <span className="font-semibold text-foreground">{workspaceName}</span>
          <span>/</span>
          <span className="text-foreground-secondary">{projectName}</span>
          <span>/</span>
          <span className="truncate font-medium text-foreground">{sessionTitle}</span>
        </div>
      </div>

      {/* End: Status & Inspector Affordances */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-2.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
          <span
            className={`inline-block size-2 rounded-full ${
              isLoading ? 'bg-warning animate-pulse' : 'bg-running'
            }`}
          />
          <span>{isLoading ? t('status.loading') : t('status.ready')}</span>
        </div>

        <button
          type="button"
          onClick={toggleFocusMode}
          aria-label={t('rail.focusMode')}
          title={t('rail.focusMode')}
          className={`flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            focusMode ? 'bg-selection text-action' : ''
          }`}
        >
          <AdhamIcon size="sm" label={t('rail.focusMode')}>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </AdhamIcon>
        </button>

        <button
          type="button"
          onClick={toggleContextPanel}
          aria-label={t('contextPanel.title')}
          title={t('contextPanel.title')}
          className={`flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            contextPanelOpen ? 'bg-selection text-action' : ''
          }`}
        >
          <AdhamIcon size="sm" label={t('contextPanel.title')}>
            <path d="M4 6h16M4 12h16m-7 6h7" />
          </AdhamIcon>
        </button>
      </div>
    </header>
  );
}
