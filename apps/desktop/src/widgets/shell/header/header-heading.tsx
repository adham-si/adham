import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AdhamIcon } from '@adham/ui';
import { useShellLayout } from '../context';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface HeaderHeadingProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  showSidebarToggle?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function HeaderHeading({
  title,
  subtitle,
  badge,
  breadcrumbs,
  showSidebarToggle = false,
  children,
  className = '',
  ...props
}: HeaderHeadingProps) {
  const { t } = useTranslation();
  const { sidebarOpen, toggleSidebar } = useShellLayout();

  return (
    <div
      className={`flex min-w-0 items-center gap-2 overflow-hidden ${className}`}
      {...props}
    >
      {showSidebarToggle && !sidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={t('sidebar.expand')}
          title={t('sidebar.expand')}
          className="flex min-h-control-sm w-7 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AdhamIcon size="sm" label={t('sidebar.expand')}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </AdhamIcon>
        </button>
      )}

      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.label}>
                {index > 0 && (
                  <span className="text-foreground-muted select-none">/</span>
                )}
                {crumb.onClick ? (
                  <button
                    type="button"
                    onClick={crumb.onClick}
                    className={`truncate transition-colors hover:text-foreground ${
                      isLast
                        ? 'font-medium text-foreground'
                        : 'text-foreground-secondary'
                    }`}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span
                    className={`truncate ${
                      isLast
                        ? 'font-medium text-foreground'
                        : 'text-foreground-secondary'
                    }`}
                  >
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      ) : title ? (
        <div className="flex items-center gap-2 truncate">
          <h1 className="truncate text-xs font-semibold text-foreground tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <span className="truncate text-xs text-foreground-muted">
              {subtitle}
            </span>
          )}
        </div>
      ) : null}

      {badge && <div className="shrink-0">{badge}</div>}

      {children}
    </div>
  );
}
