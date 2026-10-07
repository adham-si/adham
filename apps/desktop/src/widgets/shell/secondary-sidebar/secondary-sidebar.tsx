import * as React from 'react';
import { AdhamIcon } from '@adham/ui';
import { useShellLayout, SHELL_DIMENSIONS } from '../context';

export interface SecondarySidebarProps {
  title?: string;
  isOpen?: boolean;
  onClose?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shell SecondarySidebar component.
 * Constrained between min 272px and max 600px.
 */
export function SecondarySidebar({
  title = 'Explorer',
  isOpen,
  onClose,
  actions,
  children,
  className = '',
}: SecondarySidebarProps) {
  const {
    secondarySidebarOpen,
    secondarySidebarWidth,
    setSecondarySidebarWidth,
    toggleSecondarySidebar,
  } = useShellLayout();

  const isVisible = isOpen ?? secondarySidebarOpen;
  const isResizingRef = React.useRef(false);

  const handleClose = onClose ?? toggleSecondarySidebar;

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const startX = e.clientX;
      const initialWidth = secondarySidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const deltaX = moveEvent.clientX - startX;
        // In LTR, dragging rightwards increases width
        const multiplier = isRtl ? -1 : 1;
        const targetWidth = initialWidth + deltaX * multiplier;
        const clampedWidth = Math.min(
          Math.max(targetWidth, SHELL_DIMENSIONS.minSecondarySidebarWidth),
          SHELL_DIMENSIONS.maxSecondarySidebarWidth,
        );
        setSecondarySidebarWidth(clampedWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [secondarySidebarWidth, setSecondarySidebarWidth],
  );

  if (!isVisible) {
    return null;
  }

  return (
    <aside
      aria-label="Secondary Sidebar"
      style={{
        width: `${secondarySidebarWidth}px`,
        minWidth: `${SHELL_DIMENSIONS.minSecondarySidebarWidth}px`,
        maxWidth: `${SHELL_DIMENSIONS.maxSecondarySidebarWidth}px`,
        borderRadius: 'var(--radius-xl)',
        minHeight: 0,
      }}
      className={`relative flex shrink-0 flex-col rounded-xl overflow-hidden border border-border-subtle bg-surface select-none ${className}`}
    >
      {/* Secondary Sidebar Header: Height matches 40px base */}
      <div className="flex h-10 min-h-10 max-h-10 items-center justify-between border-b border-border-subtle px-3 py-1">
        <span className="truncate text-xs font-semibold text-foreground tracking-tight">
          {title}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close secondary sidebar"
            className="flex min-h-control-sm w-7 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <AdhamIcon size="sm" label="Close secondary sidebar">
              <path d="M18 6L6 18M6 6l12 12" />
            </AdhamIcon>
          </button>
        </div>
      </div>

      {/* Main Body Content */}
      <div className="flex-1 overflow-y-auto p-2">{children}</div>

      {/* Resize Handle: 272px to 600px */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize secondary sidebar"
        onMouseDown={handleMouseDown}
        className="absolute top-0 bottom-0 end-0 w-1 cursor-col-resize transition-colors hover:bg-action"
      />
    </aside>
  );
}
