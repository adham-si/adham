import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium select-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-action text-action-foreground hover:bg-action-hover active:bg-action-pressed',
        secondary:
          'bg-surface-subtle text-foreground border border-border hover:bg-surface-muted active:bg-surface-hover',
        ghost: 'bg-transparent text-foreground hover:bg-surface-subtle active:bg-surface-muted',
        danger: 'bg-danger text-danger-foreground hover:bg-danger-hover active:bg-danger-hover',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline rounded-none px-0',
      },
      size: {
        // min-h, never a fixed h-*: at 200% text the control must grow, not clip.
        sm: 'min-h-control-sm px-3 text-xs',
        md: 'min-h-control-md px-4 text-sm',
        lg: 'min-h-control-lg px-6 text-base',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a busy state: sets aria-busy and blocks activation. */
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size,
  fullWidth,
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
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

export { buttonVariants };
