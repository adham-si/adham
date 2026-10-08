import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const adhamIconVariants = cva('inline-block shrink-0', {
  variants: {
    size: {
      sm: 'size-icon-sm',
      md: 'size-icon-md',
      lg: 'size-icon-lg',
    },
    mirrored: {
      // Logical-property aware: flips with the writing direction instead of
      // assuming LTR geometry.
      true: 'rtl:-scale-x-100',
      false: '',
    },
  },
  defaultVariants: { size: 'md', mirrored: false },
});

export interface AdhamIconProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, 'children'>,
    VariantProps<typeof adhamIconVariants> {
  /** Path data. Each child is one <path d="..."> of a 24x24 viewBox. */
  children?: React.ReactNode;
  /**
   * Accessible name. Without it the icon is decorative and hidden from
   * assistive tech; with it the icon is exposed as an image with this name.
   */
  label?: string;
  ref?: React.Ref<SVGSVGElement>;
}

/**
 * A thin wrapper that fixes Adham's icon contract: one viewBox, one stroke
 * colour (`currentColor`), one size scale. Deliberately not an icon set — no
 * icon package is added, so Adham owns its own paths.
 */
export function AdhamIcon({
  size,
  mirrored = false,
  label,
  className,
  children,
  ref,
  ...props
}: AdhamIconProps) {
  const isDecorative = label === undefined;

  return (
    <svg
      {...props}
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={isDecorative ? true : undefined}
      role={isDecorative ? undefined : 'img'}
      aria-label={label}
      className={cn(adhamIconVariants({ size, mirrored }), className)}
    >
      {children}
    </svg>
  );
}

export { adhamIconVariants };
