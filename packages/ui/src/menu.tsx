import { cva } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const menuItemVariants = cva(
  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-start text-sm text-foreground transition-colors focus-visible:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-foreground-disabled',
  {
    variants: {
      active: {
        true: 'bg-selection text-foreground font-medium',
        false: '',
      },
    },
    defaultVariants: { active: false },
  },
);

interface MenuEntry {
  id: string;
  element: HTMLButtonElement | null;
  disabled: boolean;
}

interface MenuContextValue {
  register: (id: string, element: HTMLButtonElement | null, disabled: boolean) => void;
  onItemKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onSelectItem: (value: string) => void;
}

const MenuContext = React.createContext<MenuContextValue | null>(null);

function useMenuContext(): MenuContextValue {
  const context = React.useContext(MenuContext);
  if (context === null) throw new Error('MenuItem must be rendered inside MenuContent');
  return context;
}

export interface MenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** Stable identifier. Defaults to `value`, which callers should set. */
  itemId?: string;
  /** Marks the item as the currently selected one. */
  active?: boolean;
  /** The item's value, reported to onSelect. */
  value?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * One row in a menu. Must be rendered inside `MenuContent`, which owns focus
 * movement and roving tabindex — a standalone item cannot be keyboard-navigated.
 */
export function MenuItem({
  itemId,
  active = false,
  value = '',
  className,
  children,
  disabled = false,
  onClick,
  ref,
  ...props
}: MenuItemProps) {
  const { register, onItemKeyDown, onSelectItem } = useMenuContext();
  const id = itemId ?? value;

  const setRef = React.useCallback(
    (element: HTMLButtonElement | null) => {
      register(id, element, disabled);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [register, id, disabled, ref],
  );

  return (
    <button
      {...props}
      ref={setRef}
      type="button"
      role="menuitem"
      value={value}
      disabled={disabled}
      tabIndex={-1}
      onKeyDown={onItemKeyDown}
      // Mouse activation is not optional: a menu item that only responds to
      // Enter and Space is unusable with a pointer.
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelectItem(value);
      }}
      className={cn(menuItemVariants({ active }), className)}
    >
      {children}
    </button>
  );
}

/** A non-interactive divider between groups of items. Spacing comes from the
    popup's gap — no margins of its own. */
export function MenuSeparator() {
  return <div role="separator" className="h-px bg-border-subtle" />;
}

/** A labelled group of items. The heading is not focusable. */
export function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <div className="px-3 pt-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

export interface MenuProps {
  children: React.ReactNode;
  /** Accessible name for the menu. */
  label?: string | undefined;
  className?: string | undefined;
  /** Called when an item is activated. Receives the item's `value`. */
  onSelect?: ((value: string) => void) | undefined;
}

/**
 * The menu surface. Roving tabindex: every item is `tabindex="-1"` and the menu
 * manages focus itself, so the whole menu is one tab stop rather than N.
 *
 * Positioning is plain CSS — anchor it inside a `relative` wrapper. No
 * @floating-ui/react: for a v1 desktop menu that is one dependency too many.
 */
export function Menu({ children, label, className, onSelect }: MenuProps) {
  const [entries, setEntries] = React.useState<MenuEntry[]>([]);
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined);

  const register = React.useCallback(
    (id: string, element: HTMLButtonElement | null, disabled: boolean) => {
      setEntries((current) => {
        const without = current.filter((entry) => entry.id !== id);
        if (element === null) return without;
        return [...without, { id, element, disabled }].sort((a, b) => {
          if (!a.element || !b.element) return 0;
          const position = a.element.compareDocumentPosition(b.element);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
      });
    },
    [],
  );

  const focusable = React.useMemo(() => entries.filter((e) => !e.disabled), [entries]);

  // A menu must own focus: items are all tabindex="-1", so without moving focus
  // here on mount the arrow keys would go to the document and the menu would be
  // unreachable by keyboard.
  const didAutoFocus = React.useRef(false);
  React.useEffect(() => {
    if (didAutoFocus.current) return;
    if (focusable.length === 0) return;
    const first = focusable[0];
    if (first?.element === null || first?.element === undefined) return;
    didAutoFocus.current = true;
    first.element.focus();
    setActiveId(first.id);
  }, [focusable]);

  const focusAt = React.useCallback(
    (index: number) => {
      const target = focusable[index];
      if (target === undefined) return;
      target.element?.focus();
      setActiveId(target.id);
    },
    [focusable],
  );

  const step = React.useCallback(
    (delta: 1 | -1) => {
      if (focusable.length === 0) return;
      const current = activeId === undefined ? -1 : focusable.findIndex((e) => e.id === activeId);
      // Wrapping. From "nothing focused", ArrowDown enters at the first item and
      // ArrowUp enters at the last, which is the expected reversal.
      const next =
        current === -1
          ? delta === 1
            ? 0
            : focusable.length - 1
          : (current + delta + focusable.length) % focusable.length;
      focusAt(next);
    },
    [activeId, focusable, focusAt],
  );

  const onItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
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
          focusAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusAt(focusable.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          onSelect?.(event.currentTarget.value);
          break;
        default:
          break;
      }
    },
    [step, focusAt, focusable.length, onSelect],
  );

  const context = React.useMemo<MenuContextValue>(
    () => ({ register, onItemKeyDown, onSelectItem: onSelect ?? (() => {}) }),
    [register, onItemKeyDown, onSelect],
  );

  return (
    <MenuContext.Provider value={context}>
      <div
        role="menu"
        aria-label={label}
        className={cn(
          'z-menu flex min-w-48 flex-col gap-1 rounded-lg border border-border bg-surface-raised p-1',
          className,
        )}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}

interface MenuRootContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const MenuRootContext = React.createContext<MenuRootContextValue | null>(null);

function useMenuRoot(): MenuRootContextValue {
  const context = React.useContext(MenuRootContext);
  if (context === null) throw new Error('Menu parts must be rendered inside MenuRoot');
  return context;
}

/**
 * Owns open state and the trigger so Escape can return focus to the control that
 * opened the menu. Without a trigger owner, focus return has to be guessed.
 */
export function MenuRoot({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const context = React.useMemo<MenuRootContextValue>(
    () => ({ open, setOpen, triggerRef }),
    [open, setOpen],
  );

  return <MenuRootContext.Provider value={context}>{children}</MenuRootContext.Provider>;
}

export interface MenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>;
}

/** Opens the menu on click and exposes the menu's anchor for positioning. */
export function MenuTrigger({ children, onClick, ref, ...props }: MenuTriggerProps) {
  const { open, setOpen, triggerRef } = useMenuRoot();

  return (
    <button
      {...props}
      type="button"
      ref={(element: HTMLButtonElement | null) => {
        triggerRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => {
        onClick?.(event);
        setOpen(!open);
      }}
      className={cn(props.className)}
    >
      {children}
    </button>
  );
}

/**
 * The anchored popup. Closes on Escape and returns focus to the trigger, and
 * closes on an outside click.
 */
export function MenuContent({
  children,
  className,
  onSelect,
  onClose,
  label,
}: {
  children: React.ReactNode;
  className?: string | undefined;
  onSelect?: ((value: string) => void) | undefined;
  onClose?: (() => void) | undefined;
  label?: string | undefined;
}) {
  const { open, setOpen, triggerRef } = useMenuRoot();
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
    onClose?.();
  }, [setOpen, triggerRef, onClose]);

  const handleSelect = React.useCallback(
    (value: string) => {
      onSelect?.(value);
      close();
    },
    [onSelect, close],
  );

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surfaceRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, setOpen, triggerRef]);

  if (!open) return null;

  return (
    <div ref={surfaceRef} className={cn('absolute', className)}>
      <Menu label={label} onSelect={handleSelect}>
        {children}
      </Menu>
    </div>
  );
}

export { menuItemVariants };
