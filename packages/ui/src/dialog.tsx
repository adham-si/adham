import { cva } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container: HTMLElement): HTMLElement[] {
  // Deliberately not filtered on `offsetParent`: that is layout-derived and is
  // always null under jsdom, which would silently collapse the trap to one
  // element. The selector already excludes disabled and tabindex="-1" nodes;
  // `hidden` and `aria-hidden` are what actually remove a control from the trap.
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.hidden !== true && element.closest('[hidden]') === null,
  );
}

const dialogVariants = cva(
  'relative w-full max-w-lg rounded-lg border border-border bg-surface-raised p-6',
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  titleId: string;
  descriptionId: string;
  titleIdRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  hasTitle: boolean;
  registerTitle: () => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog(): DialogContextValue {
  const context = React.useContext(DialogContext);
  if (context === null) throw new Error('Dialog parts must be rendered inside DialogRoot');
  return context;
}

/**
 * Owns open state, the trigger, and the focus handoff. Focus return lives here
 * rather than in the content so it survives the content unmounting on close.
 */
export function DialogRoot({
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
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const titleIdRef = React.useRef<HTMLElement | null>(null);
  const [hasTitle, setHasTitle] = React.useState(false);

  const reactId = React.useId();
  const contentId = `${reactId}-content`;
  const titleId = `${reactId}-title`;
  const descriptionId = `${reactId}-description`;

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const context = React.useMemo<DialogContextValue>(
    () => ({
      open,
      setOpen,
      contentId,
      titleId,
      descriptionId,
      titleIdRef,
      contentRef,
      triggerRef,
      hasTitle,
      registerTitle: () => setHasTitle(true),
    }),
    [open, setOpen, contentId, titleId, descriptionId, hasTitle],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

export interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>;
}

/** Opens the dialog. */
export function DialogTrigger({ children, onClick, ref, ...props }: DialogTriggerProps) {
  const { open, setOpen, contentId, triggerRef } = useDialog();

  return (
    <button
      {...props}
      type="button"
      ref={(element: HTMLButtonElement | null) => {
        triggerRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      onClick={(event) => {
        onClick?.(event);
        setOpen(true);
      }}
    >
      {children}
    </button>
  );
}

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name. Required: a dialog with no name is announced as nothing. */
  label?: string;
  children: React.ReactNode;
}

/**
 * The dialog surface: scrim, focus trap, Escape to close.
 *
 * Focus moves in on open and returns to the trigger on close. Tab is trapped
 * while open so keyboard users cannot reach the inert page behind.
 */
export function DialogContent({ size, label, className, children, ...props }: DialogContentProps) {
  const { open, setOpen, contentId, titleId, descriptionId, contentRef, triggerRef } = useDialog();

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus in: the container itself, so a screen reader reads the label
    // before the first control rather than skipping to it.
    contentRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        (triggerRef.current ?? previouslyFocused)?.focus();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = contentRef.current;
      if (container === null) return;
      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (triggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [open, setOpen, contentRef, triggerRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <div
        data-dialog-scrim=""
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-scrim"
      />
      <div
        {...props}
        id={contentId}
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label === undefined ? titleId : undefined}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(dialogVariants({ size }), className)}
      >
        {children}
      </div>
    </div>
  );
}

export interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>;
}

/** Closes the dialog and returns focus to the trigger. */
export function DialogClose({ children, onClick, ref, ...props }: DialogCloseProps) {
  const { setOpen, triggerRef } = useDialog();

  return (
    <button
      {...props}
      type="button"
      ref={ref}
      onClick={(event) => {
        onClick?.(event);
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      {children}
    </button>
  );
}

/** The dialog's visible heading. Becomes the accessible name when no label is set. */
export function DialogTitle({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId, registerTitle } = useDialog();
  React.useEffect(() => {
    registerTitle();
  }, [registerTitle]);

  return (
    <h2 {...props} id={titleId} className={cn('mb-2 text-lg font-semibold', className)}>
      {children}
    </h2>
  );
}

/** Optional supporting copy, wired to aria-describedby. */
export function DialogDescription({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialog();
  return (
    <p
      {...props}
      id={descriptionId}
      className={cn('mb-4 text-sm text-foreground-secondary', className)}
    >
      {children}
    </p>
  );
}

export { dialogVariants };
