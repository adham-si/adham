import { cn } from './cn';

/**
 * Controlled toggle switch. Logical justify-start/end instead of a physical
 * translate keeps the knob on the correct side in RTL without a mirrored
 * class. The label stays the caller's job (aria-label or a sibling <label>/For).
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the switch is not wrapped by a <label>. */
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
  id,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-60',
        checked
          ? 'justify-end border-action bg-action'
          : 'justify-start border-border-subtle bg-surface-subtle',
        className,
      )}
    >
      <span
        className={cn(
          'size-3.5 rounded-full transition-colors',
          checked ? 'bg-action-foreground' : 'bg-foreground-secondary',
        )}
      />
    </button>
  );
}
