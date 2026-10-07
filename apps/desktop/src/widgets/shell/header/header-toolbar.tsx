import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { useShellLayout } from '../context';

export interface HeaderToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  showFocusToggle?: boolean;
  showPanelToggle?: boolean;
  showSettingsToggle?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function HeaderToolbar({
  showFocusToggle = false,
  showPanelToggle = false,
  showSettingsToggle = false,
  children,
  className = '',
  ...props
}: HeaderToolbarProps) {
  const { t } = useTranslation();
  const {
    focusMode,
    toggleFocusMode,
    contextPanelOpen,
    toggleContextPanel,
    openSettings,
  } = useShellLayout();

  return (
    <div
      className={`flex shrink-0 items-center gap-1 ${className}`}
      {...props}
    >
      {children}

      {showFocusToggle && (
        <button
          type="button"
          onClick={toggleFocusMode}
          aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
          title={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
          className={`flex min-h-control-sm items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            focusMode
              ? 'bg-selection font-medium text-action'
              : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          <AdhamIcon size="sm" label="Focus mode">
            {focusMode ? (
              <path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 10H4m0 0V4m0 6l7-7m7 7h-6m0 0V4m0 6l7-7" />
            ) : (
              <path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7M3 9V3m0 0h6M3 3l7 7m11 11v-6m0 6h-6m6 0l-7-7" />
            )}
          </AdhamIcon>
          <span className="hidden sm:inline">
            {focusMode ? 'Focus active' : 'Focus'}
          </span>
        </button>
      )}

      {showPanelToggle && (
        <button
          type="button"
          onClick={toggleContextPanel}
          aria-label={contextPanelOpen ? 'Close context panel' : 'Open context panel'}
          title={contextPanelOpen ? 'Close context panel' : 'Open context panel'}
          className={`flex min-h-control-sm w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            contextPanelOpen
              ? 'bg-selection text-action'
              : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          <AdhamIcon size="sm" label="Context panel">
            <path d="M3 3h18v18H3z M15 3v18" />
          </AdhamIcon>
        </button>
      )}

      {showSettingsToggle && (
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label={t('rail.settings')}
          title={t('rail.settings')}
          className="flex min-h-control-sm w-7 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('rail.settings')}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </AdhamIcon>
        </button>
      )}
    </div>
  );
}
