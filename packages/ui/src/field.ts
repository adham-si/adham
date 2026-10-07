import { cva } from 'class-variance-authority';

/**
 * Shared styling for Input and Textarea so the two stay in lockstep: same
 * boundary, same focus ring, same disabled and read-only treatment.
 *
 * Sizing is min-h + padding, never a fixed height — at 200% font scaling the
 * control must grow with its text, not clip it (spec §6).
 */
export const fieldVariants = cva(
  'w-full rounded-md border bg-surface text-foreground transition-colors placeholder:text-foreground-muted focus-visible:outline-2 focus-visible:outline-offset-0 disabled:bg-surface-disabled disabled:text-foreground-disabled disabled:pointer-events-none read-only:bg-surface-subtle read-only:text-foreground-secondary',
  {
    variants: {
      size: {
        sm: 'min-h-control-sm px-3 text-xs',
        md: 'min-h-control-md px-4 text-sm',
        lg: 'min-h-control-lg px-4 text-base',
      },
      invalid: {
        true: 'border-danger focus-visible:outline-danger',
        false: 'border-border focus-visible:outline-border-strong',
      },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
);

export interface FieldAccessibilityProps {
  // `invalid` comes from VariantProps, so it is not redeclared here.
  /** Error text. Rendered in a role="alert" node the field points at. */
  errorMessage?: string;
}

/**
 * Resolves `aria-invalid` and `aria-describedby` for a field and its error node.
 * Returns the attributes to spread onto the control plus the id the error element
 * needs, so both stay consistent without a shared context.
 */
export function fieldAccessibility(
  fieldId: string,
  invalid: boolean | null | undefined,
  errorMessage: string | undefined,
  callerDescribedBy: string | undefined,
): { ariaInvalid: true | undefined; ariaDescribedBy: string | undefined; errorId: string } {
  const errorId = `${fieldId}-error`;
  const hasError = errorMessage !== undefined;
  return {
    ariaInvalid: invalid === true ? true : undefined,
    ariaDescribedBy: hasError
      ? [errorId, callerDescribedBy].filter(Boolean).join(' ')
      : callerDescribedBy,
    errorId,
  };
}
