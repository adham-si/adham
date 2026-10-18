import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { Markdown, resolveMarkdownLabels, type MarkdownLabels } from './markdown-view';
import type { MessageContent } from './message-content';

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
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'content'>,
    VariantProps<typeof messageCardVariants> {
  /** Who produced the message. Rendered as a visible text label. */
  role: MessageRole;
  /** Typed message content. Schema 1 is a text part; unknown parts render inert. */
  content: MessageContent;
  /** Formatted timestamp. Rendered in a <time> element. */
  timestamp: string;
  /** Machine-readable timestamp for the <time> element's dateTime. */
  dateTime?: string;
  /** Localized renderer strings (code copy, placeholders). */
  labels?: Partial<MarkdownLabels>;
  selected?: boolean;
  /** When false the body is not editable and the card reads as read-only. */
  editable?: boolean;
  ref?: React.Ref<HTMLElement>;
}

/**
 * One conversation turn. The role is stated in words as well as colour so the
 * card is readable without colour perception, and timestamps sit in a <time>
 * element so assistive tech can announce them properly.
 *
 * Assistant text renders as safe Markdown; user and system text stays literal,
 * because that is what the author typed.
 */
export function MessageCard({
  role,
  content,
  timestamp,
  dateTime,
  labels,
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
      <MessageBody role={role} content={content} labels={labels} />
    </article>
  );
}

function MessageBody({
  role,
  content,
  labels,
}: {
  role: MessageRole;
  content: MessageContent;
  labels?: Partial<MarkdownLabels> | undefined;
}) {
  const resolved = resolveMarkdownLabels(labels);

  return (
    <div className="flex flex-col gap-2 text-sm text-foreground">
      {content.parts.map((part, index) => {
        if (part.type === 'text') {
          return role === 'assistant' ? (
            <Markdown key={index} source={part.text} labels={resolved} />
          ) : (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          );
        }
        return (
          <div key={index} className="rounded-md border border-border-subtle bg-surface-muted p-2">
            <p className="mb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
              {resolved.unsupportedContent}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs" dir="ltr">
              {part.raw}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

export { messageCardVariants, ROLE_LABEL };
