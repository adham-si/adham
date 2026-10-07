import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium select-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:not-aria-busy:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-action text-action-foreground hover:bg-action-hover active:bg-action-pressed',
        secondary:
          'bg-surface-subtle text-foreground border border-border-subtle focus-visible:border-border hover:bg-surface-muted active:bg-surface-hover',
        ghost: 'bg-transparent text-foreground hover:bg-surface-subtle active:bg-surface-muted',
        danger: 'bg-danger text-danger-surface hover:bg-danger-hover active:bg-danger-hover',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline rounded-none px-0',
      },
      size: {
        // min-h, never a fixed h-*: at 200% text the control must grow, not clip.
        sm: 'min-h-control-sm px-3 text-xs',
        md: 'min-h-control-md px-4 text-sm',
        lg: 'min-h-control-lg px-6 text-base',
      },
      // `iconOnly`: square icon-only control. The size axis still sets the hit
      // target (32/36/40); callers must pass an accessible name (aria-label).
      // After `size` on purpose: px-0 must win over the size padding in twMerge.
      iconOnly: {
        true: 'aspect-square px-0',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
      iconOnly: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a busy state: sets aria-busy, blocks activation, shows a spinner. */
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Decorative busy indicator. Stroke is `currentColor`, so the spinner inherits
 * whichever text token the variant already uses — no colour of its own.
 */
function BusySpinner({ size }: { size: 'sm' | 'md' | 'lg' | null | undefined }) {
  const iconSize = size === 'sm' ? 'size-icon-sm' : size === 'lg' ? 'size-icon-lg' : 'size-icon-md';
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0 animate-spin motion-reduce:animate-none', iconSize)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2.5} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Button({
  variant,
  size,
  fullWidth,
  iconOnly,
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled === true || loading}
      className={cn(buttonVariants({ variant, size, fullWidth, iconOnly }), className)}
      {...props}
    >
      {loading && <BusySpinner size={size} />}
      {(!loading || !iconOnly) && children}
    </button>
  );
}

export { buttonVariants };
