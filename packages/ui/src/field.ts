import { cva } from 'class-variance-authority';

/**
 * Shared styling for Input and Textarea so the two stay in lockstep: same
 * boundary, same focus ring, same disabled and read-only treatment.
 *
 * Sizing is min-h + padding, never a fixed height — at 200% font scaling the
 * control must grow with its text, not clip it (spec §6). Vertical padding is
 * py-1 (4px = --space-1): enough that textarea text never touches the top
 * border, small enough that the 32/36/40 control heights are preserved
 * (content + padding + 1px border stays within each min-h).
 *
 * Boundary: rests at --border-subtle (the label identifies the control — the
 * same documented exception as the secondary button) and stays there on hover.
 * Focus replaces the 1px border with a 2px --focus ring drawn inward
 * (outline-2, -outline-offset-1), so the border reads as thickening to 2px,
 * never as a floating offset ring. Borders are 1px everywhere: border-2/border-4
 * are forbidden by check-magic-values.
 *
 * State changes are instant — deliberately no transition: the focus ring must
 * appear fully on click, never fade in.
 */
export const fieldVariants = cva(
  'w-full rounded-md border bg-surface text-foreground placeholder:text-foreground-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus disabled:bg-surface-disabled disabled:text-foreground-disabled disabled:pointer-events-none read-only:bg-surface-subtle read-only:text-foreground-secondary',
  {
    variants: {
      size: {
        xs: 'min-h-control-xs px-2.5 py-0.5 text-xs',
        sm: 'min-h-control-sm px-3 py-1 text-xs',
        md: 'min-h-control-md px-4 py-1 text-sm',
        lg: 'min-h-control-lg px-4 py-1 text-base',
      },
      invalid: {
        true: 'border-danger focus-visible:outline-danger',
        false: 'border-border-subtle',
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
