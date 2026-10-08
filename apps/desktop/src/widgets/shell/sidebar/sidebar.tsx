import * as React from 'react';
import { SHELL_DIMENSIONS, useShellLayout } from '../context';
import { PrimarySidebar, type PrimarySidebarProps } from '../primary-sidebar';
import { SecondarySidebar, type SecondarySidebarProps } from '../secondary-sidebar';

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  isOpen?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
  side?: 'start' | 'end';
  resizable?: boolean;
  ariaLabel?: string;
  children?: React.ReactNode;
  className?: string;
  primaryProps?: PrimarySidebarProps;
  secondaryProps?: SecondarySidebarProps;
}

/**
 * Shell Sidebar component.
 * Acts as the routing composite component exposing and coordinating
 * both PrimarySidebar and SecondarySidebar (272px min to 600px max).
 * If passed children directly, acts as a generic standalone sidebar container.
 */
export function Sidebar({
  isOpen = true,
  width,
  minWidth = SHELL_DIMENSIONS.minSidebarWidth,
  maxWidth = SHELL_DIMENSIONS.maxSidebarWidth,
  onWidthChange,
  side = 'start',
  resizable = true,
  ariaLabel = 'Sidebar',
  children,
  className = '',
  primaryProps,
  secondaryProps,
  ...props
}: SidebarProps) {
  const { sidebarOpen, secondarySidebarOpen } = useShellLayout();
  const [internalWidth, setInternalWidth] = React.useState<number>(() => width ?? minWidth);
  const isResizingRef = React.useRef(false);

  const currentWidth = width ?? internalWidth;

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (!resizable) return;
      e.preventDefault();
      isResizingRef.current = true;

      const isRtl = document.documentElement.dir === 'rtl';
      const startX = e.clientX;
      const initialWidth = currentWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const deltaX = moveEvent.clientX - startX;

        // In LTR, dragging start-sidebar rightwards increases width.
        // In RTL, dragging start-sidebar rightwards decreases width.
        const multiplier = side === 'start' ? (isRtl ? -1 : 1) : isRtl ? 1 : -1;
        const targetWidth = initialWidth + deltaX * multiplier;
        const clampedWidth = Math.min(Math.max(targetWidth, minWidth), maxWidth);

        setInternalWidth(clampedWidth);
        onWidthChange?.(clampedWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [currentWidth, minWidth, maxWidth, onWidthChange, resizable, side],
  );

  // If children are explicitly provided, render as generic container
  if (children) {
    if (!isOpen) {
      return null;
    }

    const borderClass = side === 'start' ? 'border-e' : 'border-s';
    const resizeHandlePosition =
      side === 'start'
        ? 'end-0 cursor-col-resize hover:bg-action'
        : 'start-0 cursor-col-resize hover:bg-action';

    return (
      <aside
        aria-label={ariaLabel}
        style={{
          width: `${currentWidth}px`,
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          borderRadius: 'var(--radius-xl)',
          minHeight: 0,
        }}
        className={`relative flex shrink-0 flex-col rounded-xl overflow-hidden ${borderClass} border-border-subtle bg-surface select-none ${className}`}
        {...props}
      >
        {children}

        {resizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${ariaLabel}`}
            onMouseDown={handleMouseDown}
            className={`absolute top-0 bottom-0 ${resizeHandlePosition} w-1 transition-colors`}
          />
        )}
      </aside>
    );
  }

  // Composite behavior: responsible for exposing and coordinating both sidebars
  if (!sidebarOpen && !secondarySidebarOpen) {
    return null;
  }

  return (
    <>
      {sidebarOpen && <PrimarySidebar {...primaryProps} />}
      {secondarySidebarOpen && <SecondarySidebar {...secondaryProps} />}
    </>
  );
}

Sidebar.Primary = PrimarySidebar;
Sidebar.Secondary = SecondarySidebar;
