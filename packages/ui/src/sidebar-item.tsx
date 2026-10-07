import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const sidebarItemVariants = cva(
  'flex items-center gap-2 min-h-control-md ps-3 pe-3 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  {
    variants: {
      variant: {
        default:
          'text-foreground-secondary hover:bg-surface-hover hover:text-foreground active:bg-surface-muted',
        selected: 'bg-selection text-foreground font-medium hover:bg-selection',
        disabled: 'text-foreground-disabled pointer-events-none',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * Shared props for both render modes. Button and anchor attributes conflict on
 * several keys (`form`, `type`, `value`, …), so they are omitted here and the
 * element-specific ones are declared separately below.
 */
type SidebarItemBaseProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement> & React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'disabled' | 'form' | 'type' | 'value' | 'name'
>;

export interface SidebarItemProps
  extends SidebarItemBaseProps,
    VariantProps<typeof sidebarItemVariants> {
  /** Marks the item as the current page: sets aria-current and the selected surface. */
  selected?: boolean;
  disabled?: boolean;
  /** Renders an <a> instead of a <button>. */
  href?: string;
  ref?: React.Ref<HTMLButtonElement | HTMLAnchorElement>;
}

/**
 * A navigation row. Renders an `<a>` when given href and a `<button>` otherwise,
 * so keyboard and screen-reader semantics match what the row actually does.
 */
export function SidebarItem({
  variant,
  selected = false,
  disabled = false,
  href,
  className,
  children,
  ...props
}: SidebarItemProps) {
  // `selected` and `disabled` are behaviour, not just styling: they must win over
  // any variant the caller passed.
  const resolved = disabled === true ? 'disabled' : selected === true ? 'selected' : variant;
  const classes = cn(sidebarItemVariants({ variant: resolved }), className);

  if (href !== undefined) {
    // A disabled row drops href: it stops being a link, which is the honest
    // signal that it is not navigable.
    return (
      <a
        {...props}
        ref={props.ref as React.Ref<HTMLAnchorElement> | undefined}
        href={disabled === true ? undefined : href}
        aria-current={selected === true ? 'page' : undefined}
        className={classes}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      {...props}
      ref={props.ref as React.Ref<HTMLButtonElement> | undefined}
      type="button"
      disabled={disabled}
      aria-current={selected === true ? 'page' : undefined}
      className={classes}
    >
      {children}
    </button>
  );
}

export { sidebarItemVariants };
