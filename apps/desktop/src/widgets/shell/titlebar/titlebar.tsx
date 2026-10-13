import * as React from 'react';
import { useTranslation } from 'react-i18next';
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
import { usePlatform } from '@/shared/platform';
import { isRTL } from '@/shared/i18n';
import { useShellLayout } from '../context';

export interface TitlebarProps extends React.HTMLAttributes<HTMLElement> {
  onActionSelect?: (action: string) => void;
  className?: string;
}

function useLabels() {
  const { t, i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  return {
    t,
    // Panel icons depict docked regions; mirror them with the layout so the
    // glyph still points at the panel it toggles (deliberate, not decorative).
    startPanelIcon: rtl ? LayoutAlignRightIcon : LayoutAlignLeftIcon,
    endPanelIcon: rtl ? LayoutAlignLeftIcon : LayoutAlignRightIcon,
  };
}

/**
 * Chromium / Brave style Titlebar component.
 * - Fixed height: 40px (Chrome/Chromium/VS Code standard); 32px on macOS
 *   (compact native adaptation, gated by platform.isMac — true during the
 *   loading fallback on ambient macOS, so no height flash on startup)
 * - macOS buttons: 28×28 hit areas, 16px icons, vertically centered; the
 *   permanent boxed chrome (border, background, hover backplate) is removed
 *   titlebar-locally via overrides below — shared button styles untouched.
 *   Keyboard focus-visible, labels, pressed semantics and contrast stay.
 * - Top: Chrome-style secondary icon button with animated chevron (vertical
 *   open/close state, direction-neutral on purpose — no RTL mirroring)
 * - Navigation rail toggle button side by side
 * - No app name or title text
 * - Draggable middle region with data-tauri-drag-region and double-click maximize/restore
 * - End side: Layout toggles (primary sidebar, panel, secondary sidebar), vertical separator, and window action controls
 * - Native traffic lights: untouched size/placement/hover; physical-left
 *   clearance (pl-20) applies in LTR and RTL; no added bottom margin, so the
 *   shell's 4px content separation is preserved, not doubled.
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
  const { t, startPanelIcon, endPanelIcon } = useLabels();
  const platform = usePlatform();
  const [isMaximized, setIsMaximized] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
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
    const updateWindowState = async () => {
      try {
        const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
        setIsMaximized(maximized);
        setIsFullscreen(fullscreen);
      } catch {
        // ignore
      }
    };

    updateWindowState();

    win
      .listen('tauri://resize', () => {
        updateWindowState();
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

  const navRailLabel = navRailOpen
    ? t('titlebar.hideNavRail', 'Hide navigation rail')
    : t('titlebar.showNavRail', 'Show navigation rail');
  const sidebarLabel = sidebarOpen
    ? t('titlebar.hideSidebar', 'Hide primary sidebar')
    : t('titlebar.showSidebar', 'Show primary sidebar');
  const panelLabel = panelOpen
    ? t('titlebar.hidePanel', 'Hide panel')
    : t('titlebar.showPanel', 'Show panel');
  const secondaryLabel = secondarySidebarOpen
    ? t('titlebar.hideSecondary', 'Hide secondary sidebar')
    : t('titlebar.showSecondary', 'Show secondary sidebar');

  // macOS compact treatment, titlebar-local only (shared button styles
  // untouched). 28×28 hit area; 16px icons come from the existing
  // `[&_svg]:size-icon-sm` (=16px) kept below. Removes the permanent boxed
  // chrome; keyboard focus-visible, pressed semantics and contrast come from
  // the untouched base variant. Gated by platform.isMac, which is already
  // true during the loading fallback on ambient macOS.
  const isMacCompact = platform.isMac;
  const macCompactButton = isMacCompact
    ? 'h-7 min-h-7 w-7 border-0 bg-transparent hover:bg-transparent'
    : '';

  return (
    <header
      aria-label={t('titlebar.appTitlebar', 'Application Titlebar')}
      className={cn(
        'relative z-menu flex w-full shrink-0 items-center justify-between bg-background select-none',
        isMacCompact ? 'h-8 min-h-8 max-h-8' : 'h-10 min-h-10 max-h-10',
        platform.layout.hasNativeTitlebarControls &&
          !isFullscreen &&
          platform.layout.trafficLightClearanceClass,
        className,
      )}
      {...props}
    >
      {/* Start: NavRail toggle and Chrome tab-search style actions menu button */}
      <div className={cn('flex items-center gap-1', platform.layout.titlebarStartPaddingClass)}>
        <button
          type="button"
          onClick={toggleNavRail}
          aria-label={navRailLabel}
          aria-pressed={navRailOpen}
          title={navRailLabel}
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
            'cursor-default select-none text-foreground-secondary [&_svg]:size-icon-sm',
            macCompactButton,
            navRailOpen ? 'text-action' : 'text-foreground-secondary hover:text-foreground',
          )}
        >
          <HugeiconsIcon icon={startPanelIcon} />
        </button>

        <div className="relative inline-flex">
          <MenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger
              aria-label={t('titlebar.windowActions', 'Window and tab actions')}
              title={t('titlebar.actionsTitle', 'Actions')}
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
                'cursor-default select-none text-foreground-secondary [&_svg]:size-icon-sm',
                macCompactButton,
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
              label={t('titlebar.windowActionsLabel', 'Window Actions')}
              onSelect={handleMenuSelect}
              className="start-0 top-full mt-1 z-menu min-w-44"
            >
              <MenuItem value="new-session">{t('compose.newSession', 'New Session')}</MenuItem>
              <MenuItem value="open-project">{t('titlebar.openProject', 'Open Project')}</MenuItem>
              <MenuItem value="reload">{t('titlebar.reloadWindow', 'Reload Window')}</MenuItem>
              <MenuItem value="minimize">{t('titlebar.minimize', 'Minimize')}</MenuItem>
              <MenuItem value="maximize">
                {isMaximized
                  ? t('titlebar.restore', 'Restore')
                  : t('titlebar.maximize', 'Maximize')}
              </MenuItem>
              <MenuItem value="close">{t('titlebar.closeWindow', 'Close Window')}</MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>

      {/* Middle: Draggable Region (No app name or title text) */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex h-full flex-1 cursor-default items-center justify-center"
      />

      {/* End: Layout toggles, vertical separator, and window controls */}
      <div
        className={cn(
          'flex h-full items-center',
          !platform.layout.showCustomCaptionControls && 'pe-2',
        )}
      >
        {/* Layout controls */}
        <div className="flex items-center gap-1">
          {/* Primary sidebar toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarLabel}
            aria-pressed={sidebarOpen}
            title={sidebarLabel}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none text-foreground-secondary [&_svg]:size-icon-sm',
              macCompactButton,
              sidebarOpen ? 'text-action' : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={startPanelIcon} />
          </button>

          {/* Panel toggle */}
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelLabel}
            aria-pressed={panelOpen}
            title={panelLabel}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none text-foreground-secondary [&_svg]:size-icon-sm',
              macCompactButton,
              panelOpen ? 'text-action' : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={LayoutAlignBottomIcon} />
          </button>

          {/* Secondary sidebar toggle */}
          <button
            type="button"
            onClick={toggleSecondarySidebar}
            aria-label={secondaryLabel}
            aria-pressed={secondarySidebarOpen}
            title={secondaryLabel}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true }),
              'cursor-default select-none text-foreground-secondary [&_svg]:size-icon-sm',
              macCompactButton,
              secondarySidebarOpen
                ? 'text-action'
                : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            <HugeiconsIcon icon={endPanelIcon} />
          </button>
        </div>

        {/* Custom Window Controls (Windows / Linux only) */}
        {platform.layout.showCustomCaptionControls && (
          <>
            {/* Separator vertical line */}
            <div
              role="separator"
              aria-orientation="vertical"
              className="mx-2 h-4 w-px bg-border-subtle"
            />

            {/* Minimize */}
            <button
              type="button"
              onClick={handleMinimize}
              aria-label={t('titlebar.minimize', 'Minimize')}
              title={t('titlebar.minimize', 'Minimize')}
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
              aria-label={
                isMaximized ? t('titlebar.restore', 'Restore') : t('titlebar.maximize', 'Maximize')
              }
              title={
                isMaximized ? t('titlebar.restore', 'Restore') : t('titlebar.maximize', 'Maximize')
              }
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
              aria-label={t('titlebar.close', 'Close')}
              title={t('titlebar.close', 'Close')}
              className="flex h-full w-11 items-center justify-center text-foreground-secondary transition-colors hover:bg-danger hover:text-action-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <AdhamIcon size="sm">
                <path d="M18 6L6 18M6 6l12 12" />
              </AdhamIcon>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
