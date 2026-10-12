import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SidebarItem, AdhamIcon } from '@adham/ui';
import { useShellLayout, SHELL_DIMENSIONS } from '../context';

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface PrimarySidebarProps {
  workspaceName?: string;
  projectName?: string;
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
  className?: string;
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
  workspaceName = 'Personal Workspace',
  projectName = 'Default Project',
  sessions = [],
  activeSessionId,
  onSelectSession,
  onNewSession,
  className = '',
  selectionMenu,
}: PrimarySidebarProps) {
  const { t } = useTranslation();
  const { sidebarOpen, sidebarWidth, setSidebarWidth } = useShellLayout();
  const [searchFilter, setSearchFilter] = React.useState('');
  const isResizingRef = React.useRef(false);

  // Resize handle interaction supporting LTR and RTL
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const railWidth = SHELL_DIMENSIONS.navRailWidth; // 40px

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
      aria-label="Primary Sidebar"
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
                  {workspaceName}
                </span>
              </div>
              <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-foreground-muted">
                {t('compose.privacy')}
              </span>
            </div>

            {/* Current Project & New Action */}
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 overflow-hidden text-xs text-foreground-secondary">
                <AdhamIcon size="sm" label={t('project')}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </AdhamIcon>
                <span className="truncate">{projectName}</span>
              </div>
            </div>
          </>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onNewSession}
          className="w-full justify-start text-xs"
        >
          <AdhamIcon size="sm" label={t('compose.newSession')}>
            <path d="M12 4v16m8-8H4" />
          </AdhamIcon>
          <span className="truncate">{t('compose.newSession')}</span>
        </Button>
      </div>

      {/* Filter / Search Bar */}
      <div className="border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-1 text-xs text-foreground-secondary">
          <AdhamIcon size="sm" label={t('rail.search')}>
            <path d="M21 21l-4.35-4.35" />
            <circle cx="11" cy="11" r="7" />
          </AdhamIcon>
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder={t('rail.search')}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-foreground-muted focus:outline-none"
          />
        </div>
      </div>

      {/* Session History List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 px-2 py-1 text-[11px] font-semibold text-foreground-muted uppercase tracking-wider">
          {t('sessions')}
        </div>

        {filteredSessions.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-foreground-muted">
            {searchFilter ? 'No sessions found' : t('compose.emptyHistory')}
          </div>
        ) : (
          <nav aria-label="Sessions" className="flex flex-col gap-1">
            {filteredSessions.map((session) => (
              <SidebarItem
                key={session.id}
                selected={activeSessionId === session.id}
                onClick={() => onSelectSession?.(session.id)}
              >
                <AdhamIcon size="sm" label={session.title}>
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </AdhamIcon>
                <span className="truncate">{session.title}</span>
              </SidebarItem>
            ))}
          </nav>
        )}
      </div>

      {/* Resize Handle: 272px to 600px */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize primary sidebar"
        onMouseDown={handleMouseDown}
        className="absolute top-0 bottom-0 end-0 w-1 cursor-col-resize transition-colors hover:bg-action"
      />
    </aside>
  );
}
