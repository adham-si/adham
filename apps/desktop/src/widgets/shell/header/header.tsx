import * as React from 'react';

export interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shell Header component.
 * Height is fixed to 40px (4-base grid, h-10).
 */
export const Header = React.forwardRef<HTMLElement, HeaderProps>(
  ({ children, className = '', ...props }, ref) => {
    return (
      <header
        ref={ref}
        aria-label="Application Header"
        className={`flex h-10 min-h-10 max-h-10 shrink-0 items-center justify-between border-b border-border-subtle bg-surface px-3 select-none ${className}`}
        {...props}
      >
        {children}
      </header>
    );
  },
);

Header.displayName = 'Header';
