import * as React from 'react';
import { ShellLayoutProvider, useShellLayout } from './context';

export interface ShellConfig {
  headerPosition?: 'main' | 'full-width';
}

export interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {
  config?: ShellConfig;
  titlebar?: React.ReactNode;
  navRail?: React.ReactNode;
  sidebar?: React.ReactNode;
  primarySidebar?: React.ReactNode;
  secondarySidebar?: React.ReactNode;
  header?: React.ReactNode;
  panel?: React.ReactNode;
  overlays?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

function ShellInner({
  config,
  titlebar,
  navRail,
  sidebar,
  primarySidebar,
  secondarySidebar,
  header,
  panel,
  overlays,
  children,
  className = '',
  innerRef,
  ...props
}: ShellProps & { innerRef?: React.ForwardedRef<HTMLDivElement> }) {
  const {
    navRailOpen,
    sidebarOpen,
    secondarySidebarOpen,
    panelOpen,
  } = useShellLayout();
  const isFullWidthHeader = config?.headerPosition === 'full-width';

  const navRailNode = navRail && navRailOpen ? navRail : null;
  const sidebarNode = sidebar ? sidebar : null;

  const primarySidebarNode = primarySidebar && sidebarOpen ? (
    <aside
      aria-label="Primary Sidebar"
      className="flex shrink-0 flex-col border-e border-border-subtle bg-surface"
      style={{ minWidth: '272px', maxWidth: '600px' }}
    >
      {primarySidebar}
    </aside>
  ) : null;

  const secondarySidebarNode = secondarySidebar && secondarySidebarOpen ? (
    <aside
      aria-label="Secondary Sidebar"
      className="flex shrink-0 flex-col border-e border-border-subtle bg-surface"
      style={{ minWidth: '272px', maxWidth: '600px' }}
    >
      {secondarySidebar}
    </aside>
  ) : null;

  const headerNode = header ? (
    <header
      aria-label="Application Header"
      className="flex h-10 min-h-10 max-h-10 shrink-0 items-center border-b border-border-subtle bg-surface"
    >
      {header}
    </header>
  ) : null;

  const panelNode = panel && panelOpen ? panel : null;

  if (isFullWidthHeader) {
    return (
      <div
        ref={innerRef}
        style={props.style}
        className={`flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground ${className}`}
        {...props}
      >
        {titlebar}
        {headerNode}
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{ padding: '4px', gap: '4px' }}
        >
          {navRailNode}
          {sidebarNode}
          {primarySidebarNode}
          {secondarySidebarNode}
          <main className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
            {children}
          </main>
          {panelNode}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div
      ref={innerRef}
      style={props.style}
      className={`flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground ${className}`}
      {...props}
    >
      {titlebar}
      <div
        className="flex flex-1 min-h-0 overflow-hidden"
        style={{ padding: '4px', gap: '4px' }}
      >
        {navRailNode}
        {sidebarNode}
        {primarySidebarNode}
        {secondarySidebarNode}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
          {headerNode}
          <main className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
            {children}
          </main>
        </div>
        {panelNode}
      </div>
      {overlays}
    </div>
  );
}

/**
 * Shell layout wrapper component.
 * Serves as the clean root wrapper for the application.
 * Only renders slots that are explicitly provided.
 */
export const Shell = React.forwardRef<HTMLDivElement, ShellProps>((props, ref) => {
  return (
    <ShellLayoutProvider>
      <ShellInner {...props} innerRef={ref} />
    </ShellLayoutProvider>
  );
});

Shell.displayName = 'Shell';

export const ShellWrapper = Shell;
export const AppLayout = Shell;
