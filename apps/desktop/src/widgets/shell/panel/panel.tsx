import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { useShellLayout, type ContextTab, SHELL_DIMENSIONS } from '../context';

export interface PanelTabItem {
  id: ContextTab | string;
  label: string;
  icon?: React.ReactNode;
}

export interface PanelProps {
  title?: string;
  isOpen?: boolean;
  onClose?: () => void;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
  tabs?: PanelTabItem[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shell Panel component.
 * Constrained between min 272px and max 600px.
 */
export function Panel({
  title,
  isOpen,
  onClose,
  width,
  minWidth = SHELL_DIMENSIONS.minPanelWidth,
  maxWidth = SHELL_DIMENSIONS.maxPanelWidth,
  onWidthChange,
  tabs,
  activeTab,
  onTabChange,
  children,
  className = '',
}: PanelProps) {
  const { t } = useTranslation();
  const {
    contextPanelOpen,
    toggleContextPanel,
    contextPanelTab,
    setContextPanelTab,
    panelWidth,
    setPanelWidth,
  } = useShellLayout();

  const isVisible = isOpen ?? contextPanelOpen;
  const currentWidth = width ?? panelWidth;
  const handleWidthChange = onWidthChange ?? setPanelWidth;
  const handleClose = onClose ?? toggleContextPanel;

  const currentTab = activeTab ?? contextPanelTab;
  const handleTabSelect = (tabId: string) => {
    if (onTabChange) {
      onTabChange(tabId);
    } else {
      setContextPanelTab(tabId as ContextTab);
    }
  };

  const isResizingRef = React.useRef(false);

  // Resize handle interaction (start-0 since panel is docked on the end/right edge)
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const startX = e.clientX;
      const initialWidth = currentWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const deltaX = moveEvent.clientX - startX;
        // In LTR, dragging left edge to the left increases width (-deltaX)
        const multiplier = isRtl ? 1 : -1;
        const targetWidth = initialWidth + deltaX * multiplier;
        const clampedWidth = Math.min(Math.max(targetWidth, minWidth), maxWidth);
        handleWidthChange(clampedWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [currentWidth, minWidth, maxWidth, handleWidthChange],
  );

  if (!isVisible) {
    return null;
  }

  const defaultTabs: PanelTabItem[] = [
    {
      id: 'plan',
      label: t('contextPanel.tabs.plan'),
      icon: (
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      ),
    },
    {
      id: 'activity',
      label: t('contextPanel.tabs.activity'),
      icon: <path d="M13 10V3L4 14h7v7l9-11h-7z" />,
    },
    {
      id: 'graph',
      label: t('contextPanel.tabs.graph'),
      icon: (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M8.5 7.5l7 3m0 0l-7 4" />
        </>
      ),
    },
    {
      id: 'agents',
      label: t('contextPanel.tabs.agents'),
      icon: (
        <>
          <circle cx="9" cy="7" r="4" />
          <path d="M17 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </>
      ),
    },
    {
      id: 'context',
      label: t('contextPanel.tabs.context'),
      icon: <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6" />,
    },
    {
      id: 'artifacts',
      label: t('contextPanel.tabs.artifacts'),
      icon: (
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      ),
    },
  ];

  const activeTabsList = tabs ?? defaultTabs;

  return (
    <aside
      aria-label="Context Panel"
      style={{
        width: `${currentWidth}px`,
        minWidth: `${minWidth}px`,
        maxWidth: `${maxWidth}px`,
        borderRadius: 'var(--radius-xl)',
        minHeight: 0,
      }}
      className={`relative flex shrink-0 flex-col rounded-xl overflow-hidden border border-border-subtle bg-surface select-none ${className}`}
    >
      {/* Panel Header: 40px base height */}
      <div className="flex h-10 min-h-10 max-h-10 items-center justify-between border-b border-border-subtle px-3 py-1">
        <span className="truncate text-xs font-semibold text-foreground tracking-wide">
          {title ?? t('contextPanel.title')}
        </span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('contextPanel.close')}
          className="flex min-h-control-sm w-7 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('contextPanel.close')}>
            <path d="M18 6L6 18M6 6l12 12" />
          </AdhamIcon>
        </button>
      </div>

      {/* Tab Navigation Bar */}
      <div className="flex border-b border-border-subtle bg-surface-subtle overflow-x-auto">
        {activeTabsList.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabSelect(tab.id)}
              className={`flex flex-1 min-h-control-sm items-center justify-center gap-1.5 px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                isActive
                  ? 'border-b border-action bg-surface font-medium text-foreground'
                  : 'text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              {tab.icon && (
                <AdhamIcon size="sm" label={tab.label}>
                  {tab.icon}
                </AdhamIcon>
              )}
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Panel Content Body */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4 text-xs">
        {children ?? (
          <>
            {currentTab === 'plan' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Execution Plan
                </h3>
                <div className="space-y-2 rounded-md border border-border-subtle bg-surface-subtle p-3 text-xs">
                  <div className="flex items-center gap-2 text-foreground">
                    <span className="flex size-4 items-center justify-center rounded-full bg-success text-[10px] text-action-foreground">
                      ✓
                    </span>
                    <span>Initialize project workspace</span>
                  </div>
                  <div className="flex items-center gap-2 text-foreground">
                    <span className="flex size-4 items-center justify-center rounded-full bg-action text-[10px] text-action-foreground">
                      •
                    </span>
                    <span>Execute desktop shell integration</span>
                  </div>
                  <div className="flex items-center gap-2 text-foreground-muted">
                    <span className="size-4 rounded-full border border-border" />
                    <span>Verify evidence and telemetry</span>
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'activity' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Recent Activity
                </h3>
                <div className="space-y-2 text-xs text-foreground-secondary">
                  <div className="border-s border-action ps-3 py-1">
                    <div className="font-medium text-foreground">Session created</div>
                    <div className="text-[10px] text-foreground-muted">Now</div>
                  </div>
                  <div className="border-s border-border-subtle ps-3 py-1">
                    <div className="font-medium text-foreground">
                      SQLite WAL checkpoint verified
                    </div>
                    <div className="text-[10px] text-foreground-muted">1 min ago</div>
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'graph' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Task Graph
                </h3>
                <div className="rounded border border-border-subtle bg-surface-subtle p-3 text-center text-xs text-foreground-secondary">
                  Root [Task 1] → Isolated Subagent [Node A]
                </div>
              </div>
            )}

            {currentTab === 'agents' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Active Agents
                </h3>
                <div className="rounded-md border border-border-subtle bg-surface-subtle p-2 text-xs">
                  <div className="font-semibold text-foreground">Orchestrator / Manager</div>
                  <div className="text-[10px] text-running font-medium">
                    Running • Local sandboxed
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'context' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Context Sources
                </h3>
                <div className="rounded-md border border-border-subtle bg-surface-subtle p-2 text-xs text-foreground-secondary">
                  Active workspace files: isolated boundary
                </div>
              </div>
            )}

            {currentTab === 'artifacts' && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Generated Artifacts
                </h3>
                <div className="rounded-md border border-border-subtle bg-surface-subtle p-2 text-xs text-foreground-muted">
                  No artifacts produced yet
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Resize Handle: 272px to 600px */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onMouseDown={handleMouseDown}
        className="absolute top-0 bottom-0 start-0 w-1 cursor-col-resize transition-colors hover:bg-action"
      />
    </aside>
  );
}

export const ContextPanel = Panel;
