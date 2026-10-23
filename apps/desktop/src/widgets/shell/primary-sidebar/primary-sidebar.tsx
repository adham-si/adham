import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  SidebarItem,
  AdhamIcon,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@adham/ui';
import { useShellLayout, SHELL_DIMENSIONS } from '../context';

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt?: string;
  summary?: string;
  summaryOrigin?: string;
  summaryUnavailable?: boolean;
  pinned?: boolean;
  archived?: boolean;
}

export interface PrimarySidebarProps {
  workspaceName?: string;
  projectName?: string;
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
  onRenameSession?: (session: SessionSummary) => void;
  onDuplicateSession?: (session: SessionSummary) => void;
  onExportSession?: (session: SessionSummary) => void;
  onDeleteSession?: (session: SessionSummary) => void;
  onSetPinned?: (sessionId: string, pinned: boolean) => void;
  onSetArchived?: (sessionId: string, archived: boolean) => void;
  actionsDisabled?: boolean;
  actionsError?: string | null;
  /** Optional search/list panel; without it the built-in title filter renders. */
  historyPanel?: React.ReactNode;
  className?: string;
  error?: string | null;
  onRetry?: () => void;
  truncated?: boolean;
  unreadableSummaries?: number;
  creatingSession?: boolean;
  /**
   * Deliberate scope-selection UI (workspace/project discovery). When
   * provided it replaces the static workspace/project labels, which remain
   * as the unconfigured fallback.
   */
  selectionMenu?: React.ReactNode;
}

/**
 * Shell PrimarySidebar component.
 * Constrained between min 272px and max 600px.
 */
export function PrimarySidebar({
  workspaceName,
  projectName,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDuplicateSession,
  onExportSession,
  onDeleteSession,
  onSetPinned,
  onSetArchived,
  actionsDisabled = false,
  actionsError,
  className = '',
  error,
  onRetry,
  truncated,
  unreadableSummaries,
  creatingSession,
  selectionMenu,
  historyPanel,
}: PrimarySidebarProps) {
  const { t } = useTranslation();
  // App-generated fallback names when no scope is configured yet.
  const resolvedWorkspaceName =
    workspaceName ?? t('sidebar.defaultWorkspace', 'Personal Workspace');
  const resolvedProjectName = projectName ?? t('sidebar.defaultProject', 'Default Project');
  const { sidebarOpen, sidebarWidth, setSidebarWidth } = useShellLayout();
  const [searchFilter, setSearchFilter] = React.useState('');
  const isResizingRef = React.useRef(false);

  // Resize handle interaction supporting LTR and RTL
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const railWidth = SHELL_DIMENSIONS.navRailWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const currentX = moveEvent.clientX;
        const calculatedWidth = isRtl
          ? window.innerWidth - currentX - railWidth
          : currentX - railWidth;
        const clampedWidth = Math.min(
          Math.max(calculatedWidth, SHELL_DIMENSIONS.minSidebarWidth),
          SHELL_DIMENSIONS.maxSidebarWidth,
        );
        setSidebarWidth(clampedWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [setSidebarWidth],
  );

  const filteredSessions = React.useMemo(() => {
    if (!searchFilter.trim()) return sessions;
    const q = searchFilter.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchFilter]);

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside
      aria-label={t('sidebar.regionLabel', 'Primary Sidebar')}
      style={{
        width: `${sidebarWidth}px`,
        minWidth: `${SHELL_DIMENSIONS.minSidebarWidth}px`,
        maxWidth: `${SHELL_DIMENSIONS.maxSidebarWidth}px`,
        borderRadius: 'var(--radius-xl)',
        minHeight: 0,
      }}
      className={`relative flex shrink-0 flex-col rounded-xl overflow-hidden border border-border-subtle bg-surface select-none ${className}`}
    >
      {/* Workspace Switcher & Context Header */}
      <div className="flex flex-col gap-1 border-b border-border-subtle p-3">
        {selectionMenu ?? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-selection font-bold text-xs text-action">
                  W
                </span>
                <span className="truncate text-xs font-semibold text-foreground">
                  {resolvedWorkspaceName}
                </span>
              </div>
              <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-foreground-muted">
                {t('compose.privacy', 'Local')}
              </span>
            </div>

            {/* Current Project & New Action */}
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 overflow-hidden text-xs text-foreground-secondary">
                <AdhamIcon size="sm" label={t('project', 'Project')}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </AdhamIcon>
                <span className="truncate">{resolvedProjectName}</span>
              </div>
            </div>
          </>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onNewSession}
          disabled={creatingSession}
          className="w-full justify-start text-xs"
        >
          <AdhamIcon size="sm" label={t('compose.newSession', 'New Session')}>
            <path d="M12 4v16m8-8H4" />
          </AdhamIcon>
          <span className="truncate">{t('compose.newSession', 'New Session')}</span>
        </Button>
      </div>

      {historyPanel ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{historyPanel}</div>
      ) : (
        <>
          {/* Filter / Search Bar */}
          <div className="border-b border-border-subtle px-3 py-2">
            <div className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-1 text-xs text-foreground-secondary">
              <AdhamIcon size="sm" label={t('rail.search', 'Search')}>
                <path d="M21 21l-4.35-4.35" />
                <circle cx="11" cy="11" r="7" />
              </AdhamIcon>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder={t('rail.search', 'Search')}
                className="w-full bg-transparent text-xs text-foreground placeholder:text-foreground-muted focus:outline-none"
              />
            </div>
          </div>

          {/* Session History List */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="mb-1 px-2 py-1 text-[11px] font-semibold text-foreground-muted uppercase tracking-wider">
              {t('sessions', 'Sessions')}
            </div>

            {error ? (
              <div
                role="alert"
                className="m-2 flex flex-col gap-2 rounded-md border border-status-danger/30 bg-status-danger/10 p-2.5 text-xs text-status-danger"
              >
                <span>{error}</span>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="self-start font-medium underline hover:opacity-80"
                  >
                    {t('common.retry', 'Retry')}
                  </button>
                )}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-foreground-muted">
                {searchFilter
                  ? t('compose.noMatchingSessions', 'No sessions found')
                  : t('compose.emptyHistory', 'No sessions yet')}
              </div>
            ) : (
              <nav aria-label={t('sessions', 'Sessions')} className="flex flex-col gap-1">
                {unreadableSummaries && unreadableSummaries > 0 ? (
                  <div className="px-2 pb-1 text-[11px] text-foreground-muted">
                    {t('sidebar.summariesUnavailable', 'Some summaries could not be read.')}
                  </div>
                ) : null}
                {filteredSessions.map((session) => {
                  const hasActions = Boolean(
                    onRenameSession ||
                      onDuplicateSession ||
                      onExportSession ||
                      onDeleteSession ||
                      onSetPinned ||
                      onSetArchived,
                  );
                  return (
                    <div key={session.id} className="group relative">
                      <SidebarItem
                        selected={activeSessionId === session.id}
                        onClick={() => onSelectSession?.(session.id)}
                        className="items-start py-2 pe-8"
                      >
                        <AdhamIcon size="sm" label={session.title}>
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </AdhamIcon>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{session.title}</span>
                            {session.pinned ? (
                              <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-normal text-foreground-muted">
                                {t('sidebar.pinned', 'Pinned')}
                              </span>
                            ) : null}
                            {session.archived ? (
                              <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[10px] font-normal text-foreground-muted">
                                {t('sidebar.archived', 'Archived')}
                              </span>
                            ) : null}
                          </span>
                          {session.summary ? (
                            <span className="line-clamp-2 text-[11px] font-normal leading-snug text-foreground-muted">
                              {session.summary}
                            </span>
                          ) : null}
                        </span>
                      </SidebarItem>
                      {hasActions ? (
                        <MenuRoot>
                          <MenuTrigger
                            disabled={actionsDisabled}
                            aria-label={t('conversation.sessionActions.label', 'Session actions')}
                            className="absolute end-1 top-1 rounded px-1.5 py-0.5 text-sm text-foreground-muted opacity-0 hover:bg-surface-hover focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <span aria-hidden="true">⋯</span>
                          </MenuTrigger>
                          <MenuContent
                            className="end-0 top-full z-menu mt-1 min-w-40"
                            label={t('conversation.sessionActions.label', 'Session actions')}
                            onSelect={(value) => {
                              if (value === 'rename') onRenameSession?.(session);
                              if (value === 'duplicate') onDuplicateSession?.(session);
                              if (value === 'export') onExportSession?.(session);
                              if (value === 'delete') onDeleteSession?.(session);
                              if (value === 'pin') onSetPinned?.(session.id, !session.pinned);
                              if (value === 'archive')
                                onSetArchived?.(session.id, !session.archived);
                            }}
                          >
                            {onRenameSession ? (
                              <MenuItem value="rename" disabled={actionsDisabled}>
                                {t('conversation.sessionActions.rename', 'Rename')}
                              </MenuItem>
                            ) : null}
                            {onDuplicateSession ? (
                              <MenuItem value="duplicate" disabled={actionsDisabled}>
                                {t('conversation.sessionActions.duplicate', 'Duplicate')}
                              </MenuItem>
                            ) : null}
                            {onExportSession ? (
                              <MenuItem value="export" disabled={actionsDisabled}>
                                {t('conversation.sessionActions.export', 'Export Markdown')}
                              </MenuItem>
                            ) : null}
                            {onDeleteSession ? (
                              <MenuItem
                                value="delete"
                                disabled={actionsDisabled}
                                className="text-danger"
                              >
                                {t('conversation.sessionActions.delete', 'Delete from history')}
                              </MenuItem>
                            ) : null}
                            {onSetPinned ? (
                              <MenuItem value="pin" disabled={actionsDisabled}>
                                {session.pinned
                                  ? t('conversation.sessionActions.unpin', 'Unpin')
                                  : t('conversation.sessionActions.pin', 'Pin')}
                              </MenuItem>
                            ) : null}
                            {onSetArchived ? (
                              <MenuItem value="archive" disabled={actionsDisabled}>
                                {session.archived
                                  ? t('conversation.sessionActions.unarchive', 'Unarchive')
                                  : t('conversation.sessionActions.archive', 'Archive')}
                              </MenuItem>
                            ) : null}
                          </MenuContent>
                        </MenuRoot>
                      ) : null}
                    </div>
                  );
                })}
                {actionsError ? (
                  <div role="alert" className="px-2 py-1 text-[11px] text-danger-foreground">
                    {actionsError}
                  </div>
                ) : null}
                {truncated && (
                  <div className="px-2 py-1 text-[11px] italic text-foreground-muted">
                    {t('sidebar.sessionsTruncated', 'Showing latest 100 sessions (truncated)')}
                  </div>
                )}
              </nav>
            )}
          </div>
        </>
      )}

      {/* Resize Handle: 272px to 600px */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resizeLabel', 'Resize primary sidebar')}
        onMouseDown={handleMouseDown}
        className="absolute top-0 bottom-0 end-0 w-1 cursor-col-resize transition-colors hover:bg-action"
      />
    </aside>
  );
}
