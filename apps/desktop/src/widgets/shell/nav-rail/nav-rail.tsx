import * as React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Briefcase08Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@adham/ui';
import { useShellLayout, SHELL_DIMENSIONS } from '../context';

export interface NavRailProps extends React.HTMLAttributes<HTMLElement> {
  showIcons?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Shell NavigationRail component.
 * Fixed to 4-base width: 40px (w-10).
 * Holds Workspace trigger at top and Settings at footer.
 */
export function NavRail({
  showIcons = true,
  className = '',
  style,
  children,
  ...props
}: NavRailProps) {
  const { navRailOpen, sidebarOpen, toggleSidebar, openSettings } = useShellLayout();

  if (!navRailOpen) {
    return null;
  }

  return (
    <nav
      aria-label="Navigation Rail"
      style={{
        width: `${SHELL_DIMENSIONS.navRailWidth}px`,
        borderRadius: 'var(--radius-xl)',
        minHeight: 0,
        ...style,
      }}
      className={`flex w-10 min-w-10 max-w-10 shrink-0 flex-col items-center justify-between rounded-xl border border-border-subtle bg-surface py-2 select-none overflow-hidden ${className}`}
      {...props}
    >
      {children ??
        (showIcons && (
          <>
            {/* Top: Workspace */}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Workspace"
                title="Workspace"
                className={cn(
                  'flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-icon-sm',
                  sidebarOpen && 'bg-selection text-action',
                )}
              >
                <HugeiconsIcon icon={Briefcase08Icon} />
              </button>
            </div>

            {/* Bottom: Settings */}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => openSettings()}
                aria-label="Settings"
                title="Settings"
                className="flex min-h-control-sm w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-icon-sm"
              >
                <HugeiconsIcon icon={Settings01Icon} />
              </button>
            </div>
          </>
        ))}
    </nav>
  );
}

export const NavigationRail = NavRail;
