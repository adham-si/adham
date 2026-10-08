import type { VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { fieldAccessibility, fieldVariants, type FieldAccessibilityProps } from './field';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof fieldVariants>,
    FieldAccessibilityProps {
  ref?: React.Ref<HTMLTextAreaElement>;
}

/**
 * A multi-line text field sharing Input's contract. No fixed height: the caller
 * sets rows, and the field grows with wrapped text and font scaling.
 */
export function Textarea({
  size,
  invalid,
  errorMessage,
  className,
  id,
  disabled,
  readOnly,
  ref,
  ...props
}: TextareaProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const a11y = fieldAccessibility(fieldId, invalid, errorMessage, props['aria-describedby']);

  return (
    <>
      <textarea
        {...props}
        id={fieldId}
        ref={ref}
        disabled={disabled}
        readOnly={readOnly}
        // After the spread: a caller-supplied aria-invalid/aria-describedby must
        // not overwrite the wiring the error message depends on.
        aria-invalid={a11y.ariaInvalid}
        aria-describedby={a11y.ariaDescribedBy}
        className={cn(fieldVariants({ size, invalid }), 'resize-y', className)}
      />
      {errorMessage === undefined ? null : (
        <p id={a11y.errorId} role="alert" className="mt-1 text-xs text-danger-foreground">
          {errorMessage}
        </p>
      )}
    </>
  );
}
