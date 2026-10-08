import * as React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LayoutAlignLeftIcon,
  LayoutAlignBottomIcon,
  LayoutAlignRightIcon,
} from '@hugeicons/core-free-icons';
import {
  MenuRoot,
  MenuTrigger,
  MenuContent,
  MenuItem,
  AdhamIcon,
  buttonVariants,
  cn,
} from '@adham/ui';
import { useShellLayout } from '../context';

export interface TitlebarProps extends React.HTMLAttributes<HTMLElement> {
  onActionSelect?: (action: string) => void;
  className?: string;
}

/**
 * Chromium / Brave style Titlebar component.
 * - Fixed height: 40px (Chrome/Chromium/VS Code standard)
 * - Top-left: Chrome-style secondary icon button with animated chevron (pointing down, animates to top on open)
 * - Navigation rail toggle button (<HugeiconsIcon icon={LayoutAlignLeftIcon} />) side by side
 * - No app name or title text
 * - Draggable middle region with data-tauri-drag-region and double-click maximize/restore
 * - Top-right: Layout toggles (primary sidebar, panel, secondary sidebar), vertical separator, and window action controls
 */
export function Titlebar({ onActionSelect, className = '', ...props }: TitlebarProps) {
  const {
    navRailOpen,
    toggleNavRail,
    sidebarOpen,
    toggleSidebar,
    panelOpen,
    togglePanel,
    secondarySidebarOpen,
    toggleSecondarySidebar,
  } = useShellLayout();
  const [isMaximized, setIsMaximized] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Safe window reference check for both Tauri and web preview environments
  const getAppWindow = React.useCallback(() => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      return getCurrentWindow();
    }
    return null;
  }, []);

  React.useEffect(() => {
    const win = getAppWindow();
    if (!win) return;

    let unlisten: (() => void) | undefined;
    win
      .isMaximized()
      .then((maximized) => setIsMaximized(maximized))
      .catch(() => {});

    win
      .listen('tauri://resize', () => {
        win
          .isMaximized()
          .then((maximized) => setIsMaximized(maximized))
          .catch(() => {});
      })
      .then((unsub) => {
        unlisten = unsub;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [getAppWindow]);

  const handleMinimize = async () => {
    try {
      await getAppWindow()?.minimize();
    } catch {
      // ignore in web environment
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const win = getAppWindow();
      if (!win) return;
      await win.toggleMaximize();
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
    } catch {
      // ignore in web environment
    }
  };

  const handleClose = async () => {
    try {
      await getAppWindow()?.close();
    } catch {
      // ignore in web environment
    }
  };

  const handleMenuSelect = (value: string) => {
    setMenuOpen(false);
    onActionSelect?.(value);
    if (value === 'minimize') handleMinimize();
    if (value === 'maximize') handleToggleMaximize();
    if (value === 'close') handleClose();
    if (value === 'reload') window.location.reload();
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleToggleMaximize}
      aria-label="Application Titlebar"
      className={`relative z-menu flex h-10 min-h-10 max-h-10 w-full shrink-0 items-center justify-between bg-background select-none ${className}`}
      {...props}
    >
      {/* Top-Left: NavRail toggle and Chrome tab-search style actions menu button */}
      <div className="flex items-center gap-1 ps-2">
        <button
          type="button"
          onClick={toggleNavRail}
          aria-label={navRailOpen ? 'Hide navigation rail' : 'Show navigation rail'}
          aria-pressed={navRailOpen}
          title={navRailOpen ? 'Hide navigation rail' : 'Show navigation rail'}
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
            'cursor-default select-none [&_svg]:size-icon-sm',
          )}
        >
          <HugeiconsIcon icon={LayoutAlignLeftIcon} />
        </button>

        <div className="relative inline-flex">
          <MenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger
              aria-label="Window and tab actions"
              title="Actions"
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
                'cursor-default select-none',
              )}
            >
              {/* Arrow icon that smoothly animates between bottom and top on open/close */}
              <AdhamIcon
                size="sm"
                className={cn(
                  'transition-transform duration-200 ease-in-out',
                  menuOpen ? 'rotate-180' : 'rotate-0',
                )}
              >
                <path d="M6 9l6 6 6-6" />
              </AdhamIcon>
            </MenuTrigger>

            <MenuContent
              label="Window Actions"
              onSelect={handleMenuSelect}
              className="start-0 top-full mt-1 z-menu min-w-44"
            >
              <MenuItem value="new-session">New Session</MenuItem>
              <MenuItem value="open-project">Open Project</MenuItem>
              <MenuItem value="reload">Reload Window</MenuItem>
              <MenuItem value="minimize">Minimize</MenuItem>
              <MenuItem value="maximize">{isMaximized ? 'Restore' : 'Maximize'}</MenuItem>
              <MenuItem value="close">Exit</MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>

      {/* Middle: Draggable Region (No app name or title text) */}
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 cursor-default items-center justify-center"
      />

      {/* Top-Right: Layout toggles, vertical separator, and window controls */}
      <div className="flex h-full items-center">
        {/* Layout controls */}
        <div className="flex items-center gap-1">
          {/* Primary sidebar toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Hide primary sidebar' : 'Show primary sidebar'}
            aria-pressed={sidebarOpen}
            title={sidebarOpen ? 'Hide primary sidebar' : 'Show primary sidebar'}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none [&_svg]:size-icon-sm',
              !sidebarOpen && 'text-foreground-secondary opacity-60 hover:opacity-100 hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={LayoutAlignLeftIcon} />
          </button>

          {/* Panel toggle */}
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
            aria-pressed={panelOpen}
            title={panelOpen ? 'Hide panel' : 'Show panel'}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none [&_svg]:size-icon-sm',
              !panelOpen && 'text-foreground-secondary opacity-60 hover:opacity-100 hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={LayoutAlignBottomIcon} />
          </button>

          {/* Secondary sidebar toggle */}
          <button
            type="button"
            onClick={toggleSecondarySidebar}
            aria-label={secondarySidebarOpen ? 'Hide secondary sidebar' : 'Show secondary sidebar'}
            aria-pressed={secondarySidebarOpen}
            title={secondarySidebarOpen ? 'Hide secondary sidebar' : 'Show secondary sidebar'}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none [&_svg]:size-icon-sm',
              !secondarySidebarOpen && 'text-foreground-secondary opacity-60 hover:opacity-100 hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={LayoutAlignRightIcon} />
          </button>
        </div>

        {/* Separator vertical line */}
        <div
          role="separator"
          aria-orientation="vertical"
          className="mx-2 h-4 w-px bg-border-subtle"
        />

        {/* Window Controls (Minimize, Maximize / Restore, Close) */}
        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
          className="flex h-full w-11 items-center justify-center text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm">
            <path d="M5 12h14" />
          </AdhamIcon>
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm">
            {isMaximized ? (
              <>
                <rect x="5" y="9" width="10" height="10" rx="1" />
                <path d="M9 5h10v10" />
              </>
            ) : (
              <rect x="5" y="5" width="14" height="14" rx="1" />
            )}
          </AdhamIcon>
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
          className="flex h-full w-11 items-center justify-center text-foreground-secondary transition-colors hover:bg-danger hover:text-action-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm">
            <path d="M18 6L6 18M6 6l12 12" />
          </AdhamIcon>
        </button>
      </div>
    </header>
  );
}
