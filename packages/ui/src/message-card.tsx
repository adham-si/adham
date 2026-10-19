import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';
import { Markdown, resolveMarkdownLabels, type MarkdownLabels } from './markdown-view';
import { contentToText, type MessageContent } from './message-content';
import { useClipboardCopy } from './use-clipboard-copy';

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
  /** When set, the card offers a Reply action anchored to this message. */
  onReply?: (() => void) | undefined;
  /** When set, the card offers an Edit action: the message is resendable as an
   *  edited alternative. Only user messages can be edited. */
  onEdit?: (() => void) | undefined;
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
 * One conversation turn. The role is stated in words as well as colour so the
 * card is readable without colour perception, and timestamps sit in a <time>
 * element so assistive tech can announce them properly.
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
  labels,
  selected = false,
  editable = false,
  onReply,
  onEdit,
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

  return (
    <article
      {...props}
      ref={ref}
      aria-label={label}
      className={cn(messageCardVariants({ role, selected, editable }), className)}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="font-semibold tracking-wide uppercase">{label}</span>
          {branch &&
            (branch.active ? (
              <span className="rounded-sm border border-border-subtle px-1 text-foreground-secondary">
                {resolved.branchActiveLabel}
              </span>
            ) : (
              branch.onMakeActive && (
                <button
                  type="button"
                  className="rounded-sm px-1 text-foreground-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={branch.onMakeActive}
                >
                  {resolved.branchMakeActiveLabel}
                </button>
              )
            ))}
        </span>
        <span className="flex items-center gap-2">
          {onEdit && (
            <button
              type="button"
              className="rounded-sm px-1 text-foreground-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={onEdit}
            >
              {resolved.editAction}
            </button>
          )}
          {onReply && (
            <button
              type="button"
              className="rounded-sm px-1 text-foreground-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={onReply}
            >
              {resolved.replyAction}
            </button>
          )}
          {copyText.length > 0 && (
            <button
              type="button"
              className="rounded-sm px-1 text-foreground-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={() => {
                void copy(copyText);
              }}
            >
              {resolved.copyMessage}
            </button>
          )}
          <span role="status" className="text-foreground-muted">
            {copyState === 'copied'
              ? resolved.copied
              : copyState === 'failed'
                ? resolved.copyFailed
                : ''}
          </span>
          <time className="text-foreground-muted" dateTime={dateTime ?? timestamp}>
            {timestamp}
          </time>
        </span>
      </div>
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
      <MessageBody role={role} content={content} resolved={resolved} />
      {onFeedback && (
        <FeedbackControls feedback={feedback} onFeedback={onFeedback} resolved={resolved} />
      )}
    </article>
  );
}

/** Like/dislike for one answer attempt. The stored verdict is the only
 *  pressed state, so a refused save never flips a button. The reason is
 *  optional: Enter saves it on top of the current verdict, and a pending
 *  draft survives a failed save. */
function FeedbackControls({
  feedback,
  onFeedback,
  resolved,
}: {
  feedback?: { verdict: 'like' | 'dislike'; reason: string | null } | undefined;
  onFeedback: (verdict: 'like' | 'dislike' | null, reason: string | null) => void;
  resolved: MarkdownLabels;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  const verdictButton = (verdict: 'like' | 'dislike', label: string) => (
    <button
      type="button"
      aria-pressed={feedback?.verdict === verdict}
      className={cn(
        'rounded-sm px-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        feedback?.verdict === verdict
          ? 'bg-surface-hover text-foreground'
          : 'text-foreground-secondary',
      )}
      onClick={() => {
        if (feedback?.verdict === verdict) {
          // Toggle off: the verdict and its reason are removed together.
          setDraft(null);
          onFeedback(null, null);
        } else {
          onFeedback(verdict, feedback?.reason ?? null);
        }
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {verdictButton('like', resolved.likeAction)}
      {verdictButton('dislike', resolved.dislikeAction)}
      {feedback && (
        <input
          type="text"
          aria-label={resolved.feedbackReason}
          placeholder={resolved.feedbackReason}
          value={draft ?? feedback.reason ?? ''}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            // Trimmed now so what is shown is what will be stored; the draft
            // stays until a response replaces the stored value.
            const reason = (draft ?? feedback.reason ?? '').trim();
            setDraft(reason);
            onFeedback(feedback.verdict, reason);
          }}
          className="min-w-0 flex-1 rounded-sm border border-border-subtle bg-surface-muted px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      )}
    </div>
  );
}

function MessageBody({
  role,
  content,
  resolved,
}: {
  role: MessageRole;
  content: MessageContent;
  resolved: MarkdownLabels;
}) {
  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto text-sm text-foreground">
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
