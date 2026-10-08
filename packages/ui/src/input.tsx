import type { VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { fieldAccessibility, fieldVariants, type FieldAccessibilityProps } from './field';

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof fieldVariants>,
    FieldAccessibilityProps {
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * A single-line text field. Use `htmlFor` on a `<label>` pointing at the field's
 * `id`; pass `errorMessage` and the field wires itself to the error node.
 */
export function Input({
  size,
  invalid,
  errorMessage,
  className,
  id,
  disabled,
  readOnly,
  ref,
  ...props
}: InputProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const a11y = fieldAccessibility(fieldId, invalid, errorMessage, props['aria-describedby']);

  return (
    <>
      <input
        {...props}
        id={fieldId}
        ref={ref}
        disabled={disabled}
        readOnly={readOnly}
        // After the spread: a caller-supplied aria-invalid/aria-describedby must
        // not overwrite the wiring the error message depends on.
        aria-invalid={a11y.ariaInvalid}
        aria-describedby={a11y.ariaDescribedBy}
        className={cn(fieldVariants({ size, invalid }), className)}
      />
      {errorMessage === undefined ? null : (
        <p id={a11y.errorId} role="alert" className="mt-1 text-xs text-danger-foreground">
          {errorMessage}
        </p>
      )}
    </>
  );
}
