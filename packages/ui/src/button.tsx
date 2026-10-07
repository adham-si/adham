import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none';

    const sizeStyles = {
      sm: 'h-8 px-3 text-xs rounded-[var(--radius-sm,4px)]',
      md: 'h-10 px-4 text-sm rounded-[var(--radius-md,8px)]',
      lg: 'h-12 px-6 text-base rounded-[var(--radius-lg,12px)]',
    }[size];

    const variantStyles = {
      primary:
        'bg-[var(--color-brand,#2B2BFF)] text-white hover:bg-[var(--color-brand-hover,#1E1EDD)] active:bg-[var(--color-brand-active,#1515B8)] focus-visible:ring-[var(--color-brand,#2B2BFF)]',
      secondary:
        'bg-[var(--color-bg-subtle,#F4F4F6)] text-[var(--color-text-primary,#121214)] hover:bg-[var(--color-bg-muted,#EAEAED)] border border-[var(--color-border-subtle,#E2E2E6)]',
      ghost:
        'bg-transparent text-[var(--color-text-primary,#121214)] hover:bg-[var(--color-bg-subtle,#F4F4F6)]',
      danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    }[variant];

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
