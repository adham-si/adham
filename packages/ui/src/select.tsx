import type { VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { fieldAccessibility, fieldVariants, type FieldAccessibilityProps } from './field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

const INDICATOR_ICON = {
  xs: '[&_svg]:size-icon-sm',
  sm: '[&_svg]:size-icon-sm',
  md: '[&_svg]:size-icon-md',
  lg: '[&_svg]:size-icon-lg',
} as const;

const optionClasses =
  'flex w-full shrink-0 items-center gap-2 rounded-sm text-start text-foreground hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-foreground-disabled aria-selected:bg-selection aria-selected:font-medium';

// Option text tracks the trigger size: an sm trigger (12px) must not open a
// 14px-text popup. All pairs are spacing/typography tokens. xs shares the
// sm icon scale (see Button) and tightens padding to its px-2.5 py-0.5 trigger.
const OPTION_TEXT = {
  xs: 'px-2.5 py-0.5 text-xs',
  sm: 'px-3 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-2 text-base',
} as const;

export interface SelectProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onSelect' | 'value'>,
    VariantProps<typeof fieldVariants>,
    FieldAccessibilityProps {
  options: SelectOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  /** Glyph shown when closed. The app passes its own icon (e.g. Hugeicons) — ui ships none. */
  indicator?: React.ReactNode;
  /** Glyph shown when open. Falls back to `indicator`. */
  indicatorOpen?: React.ReactNode;
  id?: string | undefined;
  listboxClassName?: string | undefined;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * A single-select dropdown with the field boundary contract: 1px quiet rest,
 * 2px branded ring on focus, danger on invalid, instant state changes.
 * The popup is plain CSS inside a `relative` wrapper — same rule as Menu.
 */
export function Select({
  size,
  invalid,
  errorMessage,
  options,
  value: controlledValue,
  defaultValue,
  onValueChange,
  placeholder,
  indicator,
  indicatorOpen,
  className,
  listboxClassName,
  id,
  disabled,
  onClick,
  onKeyDown,
  ref,
  ...props
}: SelectProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const listboxId = `${fieldId}-listbox`;
  const a11y = fieldAccessibility(fieldId, invalid, errorMessage, props['aria-describedby']);

  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const value = controlledValue ?? uncontrolledValue;
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | undefined>(undefined);

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement | null>());

  const enabledValues = React.useMemo(
    () => options.filter((option) => !option.disabled).map((option) => option.value),
    [options],
  );
  const selected = options.find((option) => option.value === value);

  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    setHighlighted(undefined);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const selectValue = React.useCallback(
    (next: string) => {
      if (controlledValue === undefined) setUncontrolledValue(next);
      onValueChange?.(next);
      close(true);
    },
    [controlledValue, onValueChange, close],
  );

  const openList = React.useCallback(
    (initial?: string | undefined) => {
      if (disabled === true || enabledValues.length === 0) return;
      const fallback = enabledValues.includes(value ?? '') ? value : enabledValues[0];
      setHighlighted(initial ?? fallback);
      setOpen(true);
    },
    [disabled, enabledValues, value],
  );

  const step = React.useCallback(
    (delta: 1 | -1) => {
      if (enabledValues.length === 0) return;
      const current = highlighted ?? value;
      const index = current === undefined ? -1 : enabledValues.indexOf(current);
      const next =
        index === -1
          ? delta === 1
            ? enabledValues[0]
            : enabledValues[enabledValues.length - 1]
          : enabledValues[(index + delta + enabledValues.length) % enabledValues.length];
      setHighlighted(next);
    },
    [enabledValues, highlighted, value],
  );

  // The list owns focus while open (roving focus, like Menu): every option is
  // tabindex="-1" and focus moves here, so the popup is reachable by keyboard.
  React.useEffect(() => {
    if (!open) return;
    optionRefs.current.get(highlighted ?? '')?.focus();
  }, [open, highlighted]);

  // Outside click closes without stealing focus; the trigger is excluded so a
  // click on it toggles instead.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surfaceRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      setOpen(false);
      setHighlighted(undefined);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setHighlighted(enabledValues[0]);
        break;
      case 'End':
        event.preventDefault();
        setHighlighted(enabledValues[enabledValues.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Deferred: closing synchronously would unmount the focused option
        // before the browser resolves tab order. Focus moves first, then the
        // list unmounts underneath it.
        setTimeout(() => {
          setOpen(false);
          setHighlighted(undefined);
        }, 0);
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative">
      <button
        {...props}
        type="button"
        id={fieldId}
        ref={(element: HTMLButtonElement | null) => {
          triggerRef.current = element;
          if (typeof ref === 'function') ref(element);
          else if (ref) ref.current = element;
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-invalid={a11y.ariaInvalid}
        aria-describedby={a11y.ariaDescribedBy}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) close(true);
          else openList();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          // Enter/Space activate natively through onClick; arrows need help.
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openList();
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const last = enabledValues[enabledValues.length - 1];
            openList(value !== undefined && enabledValues.includes(value) ? value : last);
          }
        }}
        className={cn(
          fieldVariants({ size, invalid }),
          'flex items-center justify-between gap-2 text-start',
          className,
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            selected ? 'text-foreground' : 'text-foreground-muted',
          )}
        >
          {selected?.label ?? placeholder ?? ''}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none flex shrink-0 items-center text-foreground-muted',
            INDICATOR_ICON[size ?? 'md'],
          )}
        >
          {open ? (indicatorOpen ?? indicator) : indicator}
        </span>
      </button>
      {open ? (
        <div ref={surfaceRef} className={cn('absolute start-0 end-0 top-full z-menu mt-1')}>
          <div
            role="listbox"
            id={listboxId}
            aria-label={selected?.label ?? placeholder}
            onKeyDown={onListKeyDown}
            className={cn(
              'flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border-subtle bg-surface-raised p-1',
              listboxClassName,
            )}
          >
            {options.map((option) => (
              <button
                key={option.value}
                ref={(element: HTMLButtonElement | null) => {
                  if (element === null) optionRefs.current.delete(option.value);
                  else optionRefs.current.set(option.value, element);
                }}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                tabIndex={-1}
                onClick={() => selectValue(option.value)}
                className={cn(optionClasses, OPTION_TEXT[size ?? 'md'])}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {errorMessage === undefined ? null : (
        <p id={a11y.errorId} role="alert" className="mt-1 text-xs text-danger-foreground">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
