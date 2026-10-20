import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { Markdown, resolveMarkdownLabels, type MarkdownLabels } from './markdown-view';
import { MessageActions, type MessageActionIcons, type MessageActionMenu } from './message-actions';
import { contentToText, type MessageContent } from './message-content';
import { useClipboardCopy } from './use-clipboard-copy';

const messageCardVariants = cva('rounded-lg border bg-surface p-4 text-start transition-colors', {
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
});

/** Role is stated as text, never carried by colour alone (WCAG 1.4.1). */
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
  /** Optional content inside the card above the quote/body (e.g. the files a
   *  user turn was sent with). Kept inside the bubble so it reads as part of
   *  the message, not a detached row. */
  leading?: React.ReactNode;
  /** Formatted timestamp. Rendered in a <time> element. */
  timestamp: string;
  /** Machine-readable timestamp for the <time> element's dateTime. */
  dateTime?: string;
  /** Header identity: what this card calls its author. Defaults to the role
   *  label; the app passes the answering model's name for assistant rows. */
  name?: string | undefined;
  /** Header avatar node, supplied by the app (the UI package ships no icon
   *  set). Decorative: the name next to it carries the identity. */
  avatar?: React.ReactNode;
  /** Localized renderer strings (code copy, placeholders). */
  labels?: Partial<MarkdownLabels>;
  selected?: boolean;
  /** When false the body is not editable and the card reads as read-only. */
  editable?: boolean;
  /** When set, the card offers a Reply action anchored to this message. */
  onReply?: (() => void) | undefined;
  /** When set, the card offers an Edit action: the message is resendable as an
   *  edited alternative. Only user messages can be edited. */
  onEdit?: (() => void) | undefined;
  /** When set, the card offers Regenerate for this answer attempt. */
  onRegenerate?: (() => void) | undefined;
  /** Disables Regenerate while a turn is already running. */
  regenerateDisabled?: boolean | undefined;
  /** Action-row glyphs; without them the controls show their words. */
  icons?: MessageActionIcons | undefined;
  /** True while this answer is still arriving: trails the body with a caret. */
  streaming?: boolean;
  /** Excerpt of the message this card quotes. undefined = no recorded quote
   *  (nothing renders); null = the quote target is not in the loaded history,
   *  which is stated instead of an invented excerpt. */
  quotedExcerpt?: string | null | undefined;
  /** Relation of the recorded quote: 'edited-from' labels the block as an
   *  edit lineage ("Edited from") instead of a reply quote. */
  quotedRelation?: string | undefined;
  /** Edited-branch provenance: a static marker on the member the session
   *  continues from, and on other members the action that switches to them. */
  branch?: { active: boolean; onMakeActive?: (() => void) | undefined } | undefined;
  /** Stored like/dislike verdict for this answer row (one attempt). */
  feedback?: { verdict: 'like' | 'dislike'; reason: string | null } | undefined;
  /** When set, the card offers Like/Dislike for this answer. verdict null
   *  removes the stored feedback. Only settled, persisted assistant rows get
   *  this: a provisional or streaming bubble offers nothing to rate. */
  onFeedback?: ((verdict: 'like' | 'dislike' | null, reason: string | null) => void) | undefined;
  ref?: React.Ref<HTMLElement>;
}

/**
 * One conversation turn: a header naming the author, the content in a card,
 * and the actions grouped under that card. The header and actions live outside
 * the card so the bubble carries only what was said. The role remains the
 * article's accessible name, while the visible name is the model that answered
 * when the caller knows it.
 *
 * Assistant text renders as safe Markdown; user and system text stays literal,
 * because that is what the author typed.
 *
 * Every card offers Copy: the awaited clipboard outcome is stated next to the
 * button, so a copy that failed never looks like one that worked.
 */
export function MessageCard({
  role,
  content,
  timestamp,
  dateTime,
  name,
  avatar,
  labels,
  leading,
  selected = false,
  editable = false,
  onReply,
  onEdit,
  onRegenerate,
  regenerateDisabled,
  icons,
  streaming = false,
  quotedExcerpt,
  quotedRelation,
  branch,
  feedback,
  onFeedback,
  className,
  ref,
  ...props
}: MessageCardProps) {
  const label = ROLE_LABEL[role];
  const resolved = resolveMarkdownLabels(labels);
  const copyText = React.useMemo(() => contentToText(content), [content]);
  const { state: copyState, copy } = useClipboardCopy();

  const menu: MessageActionMenu | undefined =
    onEdit !== undefined ||
    onReply !== undefined ||
    (branch !== undefined && !branch.active && branch.onMakeActive !== undefined)
      ? {
          edit: onEdit,
          reply: onReply,
          makeActive: branch !== undefined && !branch.active ? branch.onMakeActive : undefined,
        }
      : undefined;

  return (
    <article
      {...props}
      ref={ref}
      aria-label={label}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        role === 'user' ? 'max-w-full self-end' : 'w-full self-start',
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        {avatar !== undefined && (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-subtle text-foreground-secondary"
          >
            {avatar}
          </span>
        )}
        <span className="text-sm font-medium text-foreground">{name ?? label}</span>
        {branch?.active === true && (
          <span className="rounded-sm border border-border-subtle px-1 text-xs text-foreground-secondary">
            {resolved.branchActiveLabel}
          </span>
        )}
        <time
          className="text-xs text-foreground-muted tabular-nums"
          dateTime={dateTime ?? timestamp}
        >
          {timestamp}
        </time>
      </header>
      <div className={cn(messageCardVariants({ role, selected, editable }), className)}>
        {leading !== undefined && <div className="mb-2">{leading}</div>}
        {quotedExcerpt !== undefined && (
          <div className="mb-2 border-s-2 border-border-strong ps-2">
            <p className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">
              {quotedRelation === 'edited-from' ? resolved.quoteEditedLabel : resolved.quoteLabel}
            </p>
            <p className="line-clamp-3 whitespace-pre-wrap text-xs text-foreground-secondary">
              {quotedExcerpt === null ? resolved.quoteUnavailable : quotedExcerpt}
            </p>
          </div>
        )}
        <MessageBody
          role={role}
          content={content}
          resolved={resolved}
          streaming={streaming}
          copyIcon={icons?.copy}
        />
      </div>
      <MessageActions
        resolved={resolved}
        icons={icons}
        copyText={copyText}
        copyState={copyState}
        onCopy={() => {
          void copy(copyText);
        }}
        regenerate={onRegenerate}
        regenerateDisabled={regenerateDisabled}
        feedback={feedback}
        onFeedback={onFeedback}
        menu={menu}
      />
    </article>
  );
}

function MessageBody({
  role,
  content,
  resolved,
  streaming,
  copyIcon,
}: {
  role: MessageRole;
  content: MessageContent;
  resolved: MarkdownLabels;
  streaming: boolean;
  copyIcon?: React.ReactNode | undefined;
}) {
  return (
    <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-base leading-6 text-foreground">
      {content.parts.map((part, index) => {
        if (part.type === 'text') {
          return role === 'assistant' ? (
            <Markdown
              key={index}
              source={part.text}
              labels={resolved}
              copyIcon={copyIcon}
              streaming={streaming}
            />
          ) : (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          );
        }
        return (
          <div key={index} className="rounded-lg border border-border-subtle bg-surface-muted p-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">
              {resolved.unsupportedContent}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs" dir="ltr">
              {part.raw}
            </pre>
          </div>
        );
      })}
      {streaming && (
        <span
          aria-hidden="true"
          className="block h-4 w-0.5 animate-pulse rounded-full bg-foreground-secondary motion-reduce:animate-none"
        />
      )}
    </div>
  );
}

export { messageCardVariants, ROLE_LABEL };
