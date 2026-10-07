import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SidebarItem, AdhamIcon } from '@adham/ui';
import { useShellLayout } from './layout-context';

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
}

export function PrimarySidebar({
  workspaceName = 'Personal Workspace',
  projectName = 'Default Project',
  sessions = [],
  activeSessionId,
  onSelectSession,
  onNewSession,
}: PrimarySidebarProps) {
  const { t } = useTranslation();
  const { sidebarOpen, sidebarWidth, setSidebarWidth } = useShellLayout();
  const isResizingRef = React.useRef(false);

  // Resize handle interaction supporting LTR and RTL
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const railWidth = 40; // Rail is 40px

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const currentX = moveEvent.clientX;
        const calculatedWidth = isRtl
          ? window.innerWidth - currentX - railWidth
          : currentX - railWidth;
        setSidebarWidth(calculatedWidth);
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

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside
      aria-label="Primary Sidebar"
      style={{ width: `${sidebarWidth}px` }}
      className="relative flex shrink-0 flex-col border-e border-border-subtle bg-surface select-none"
    >
      {/* Workspace Switcher & Context Header */}
      <div className="flex flex-col gap-2 border-b border-border-subtle p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-selection font-bold text-xs text-action">
              W
            </span>
            <span className="truncate text-xs font-semibold text-foreground">{workspaceName}</span>
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

        <Button
          variant="secondary"
          size="sm"
          onClick={onNewSession}
          className="mt-1 w-full justify-start gap-2"
        >
          <AdhamIcon size="sm" label={t('sidebar.newTask')}>
            <path d="M12 4v16m8-8H4" />
          </AdhamIcon>
          <span>{t('sidebar.newTask')}</span>
        </Button>
      </div>

      {/* Sessions List */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        <div className="ps-2 pe-2 pt-2 pb-1 text-[11px] font-semibold text-foreground-muted tracking-wider uppercase">
          {t('sidebar.recentSessions')}
        </div>

        {sessions.length === 0 ? (
          <div className="p-3 text-center text-xs text-foreground-muted">
            {t('sidebar.noSessions')}
          </div>
        ) : (
          sessions.map((session) => {
            const isSelected = session.id === activeSessionId;
            return (
              <SidebarItem
                key={session.id}
                selected={isSelected}
                onClick={() => onSelectSession?.(session.id)}
                className="w-full text-start"
              >
                <AdhamIcon size="sm" label="Session">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </AdhamIcon>
                <span className="truncate">{session.title}</span>
              </SidebarItem>
            );
          })
        )}
      </div>

      {/* Resize Handle on logical end border */}
      <div
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        className="absolute top-0 bottom-0 end-0 w-1 cursor-col-resize transition-colors hover:bg-focus"
      />
    </aside>
  );
}
