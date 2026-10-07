import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const messageCardVariants = cva(
  'rounded-lg border bg-surface p-4 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  {
    variants: {
      role: {
        user: 'border-border-subtle bg-surface-muted',
        assistant: 'border-border-subtle bg-surface',
        system: 'border-border-subtle bg-surface-subtle',
      },
      selected: {
        true: 'border-border-interactive bg-selection',
        false: '',
      },
      editable: {
        true: 'border-dashed',
        false: '',
      },
    },
    defaultVariants: { role: 'assistant', selected: false, editable: false },
  },
);

/** Role is rendered as text, never carried by colour alone (WCAG 1.4.1). */
const ROLE_LABEL: Record<MessageRole, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageCardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children'>,
    VariantProps<typeof messageCardVariants> {
  /** Who produced the message. Rendered as a visible text label. */
  role: MessageRole;
  /** Message body. */
  text: string;
  /** Formatted timestamp. Rendered in a <time> element. */
  timestamp: string;
  /** Machine-readable timestamp for the <time> element's dateTime. */
  dateTime?: string;
  selected?: boolean;
  /** When false the body is not editable and the card reads as read-only. */
  editable?: boolean;
  ref?: React.Ref<HTMLElement>;
}

/**
 * One conversation turn. The role is stated in words as well as colour so the
 * card is readable without colour perception, and timestamps sit in a <time>
 * element so assistive tech can announce them properly.
 */
export function MessageCard({
  role,
  text,
  timestamp,
  dateTime,
  selected = false,
  editable = false,
  className,
  ref,
  ...props
}: MessageCardProps) {
  const label = ROLE_LABEL[role];

  return (
    <article
      {...props}
      ref={ref}
      aria-label={label}
      className={cn(messageCardVariants({ role, selected, editable }), className)}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold tracking-wide uppercase">{label}</span>
        <time className="text-foreground-muted" dateTime={dateTime ?? timestamp}>
          {timestamp}
        </time>
      </div>
      <p className="text-sm whitespace-pre-wrap text-foreground">{text}</p>
    </article>
  );
}

export { messageCardVariants, ROLE_LABEL };
