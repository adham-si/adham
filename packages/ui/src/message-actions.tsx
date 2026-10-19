import * as React from 'react';
import { Button, buttonVariants } from './button';
import { cn } from './cn';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from './menu';
import type { MarkdownLabels } from './markdown-view';
import type { CopyState } from './use-clipboard-copy';

/**
 * Glyphs for the action row. The UI package deliberately ships no icon set,
 * so the app passes the nodes; a control without one shows its word instead.
 */
export interface MessageActionIcons {
  copy?: React.ReactNode;
  edit?: React.ReactNode;
  regenerate?: React.ReactNode;
  like?: React.ReactNode;
  dislike?: React.ReactNode;
  more?: React.ReactNode;
}

/** One-time actions: Edit sits in the row beside Copy; Reply and the branch
 *  switch live behind the ⋮ trigger so the row stays short. */
export interface MessageActionMenu {
  edit?: (() => void) | undefined;
  reply?: (() => void) | undefined;
  makeActive?: (() => void) | undefined;
}

export interface MessageActionsProps {
  resolved: MarkdownLabels;
  icons?: MessageActionIcons | undefined;
  /** The text Copy would place on the clipboard; empty hides the control. */
  copyText: string;
  copyState: CopyState;
  onCopy: () => void;
  regenerate?: (() => void) | undefined;
  regenerateDisabled?: boolean | undefined;
  feedback?: { verdict: 'like' | 'dislike'; reason: string | null } | undefined;
  onFeedback?: ((verdict: 'like' | 'dislike' | null, reason: string | null) => void) | undefined;
  menu?: MessageActionMenu | undefined;
}

/**
 * One message's actions, grouped under its content: copy, edit (beside copy,
 * where the caller offers it), regenerate, the like/dislike verdicts, and a ⋮
 * menu for the rest. The awaited clipboard outcome is stated next to the
 * controls, so a copy that failed never looks like one that worked.
 */
export function MessageActions({
  resolved,
  icons,
  copyText,
  copyState,
  onCopy,
  regenerate,
  regenerateDisabled,
  feedback,
  onFeedback,
  menu,
}: MessageActionsProps) {
  const hasMenu = menu !== undefined && (menu.reply !== undefined || menu.makeActive !== undefined);

  if (
    copyText.length === 0 &&
    menu?.edit === undefined &&
    regenerate === undefined &&
    onFeedback === undefined &&
    !hasMenu
  ) {
    return null;
  }

  /** Toggling a stored verdict off removes it and its reason together. */
  const verdict = (value: 'like' | 'dislike') => {
    if (onFeedback === undefined) return;
    if (feedback?.verdict === value) onFeedback(null, null);
    else onFeedback(value, feedback?.reason ?? null);
  };

  return (
    <footer className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center justify-end gap-1 text-foreground-secondary">
        {copyText.length > 0 && (
          <ActionControl label={resolved.copyMessage} icon={icons?.copy} onClick={onCopy} />
        )}
        {menu?.edit !== undefined && (
          <ActionControl label={resolved.editAction} icon={icons?.edit} onClick={menu.edit} />
        )}
        {regenerate !== undefined && (
          <ActionControl
            label={resolved.regenerateAction}
            icon={icons?.regenerate}
            disabled={regenerateDisabled === true}
            onClick={regenerate}
          />
        )}
        {onFeedback !== undefined && (
          <>
            <ActionControl
              label={resolved.likeAction}
              icon={icons?.like}
              pressed={feedback?.verdict === 'like'}
              onClick={() => verdict('like')}
            />
            <ActionControl
              label={resolved.dislikeAction}
              icon={icons?.dislike}
              pressed={feedback?.verdict === 'dislike'}
              onClick={() => verdict('dislike')}
            />
          </>
        )}
        <span role="status" className="ps-1 text-foreground-muted">
          {copyState === 'copied'
            ? resolved.copied
            : copyState === 'failed'
              ? resolved.copyFailed
              : ''}
        </span>
        {hasMenu && menu !== undefined && (
          <span className="relative inline-flex">
            <MenuRoot>
              <MenuTrigger
                aria-label={resolved.moreActions}
                title={resolved.moreActions}
                className={cn(
                  buttonVariants({
                    variant: 'ghost',
                    size: 'xs',
                    iconOnly: icons?.more !== undefined,
                  }),
                  'text-foreground-secondary',
                )}
              >
                {icons?.more ?? resolved.moreActions}
              </MenuTrigger>
              {/* Opens upward: a message footer sits at the bottom of the row,
                  and the timeline clips a panel that grows past its end. */}
              <MenuContent
                label={resolved.moreActions}
                className="end-0 bottom-full mb-1"
                onSelect={(value) => {
                  if (value === 'reply') menu.reply?.();
                  else if (value === 'make-active') menu.makeActive?.();
                }}
              >
                {menu.reply !== undefined && (
                  <MenuItem value="reply">{resolved.replyAction}</MenuItem>
                )}
                {menu.makeActive !== undefined && (
                  <MenuItem value="make-active">{resolved.branchMakeActiveLabel}</MenuItem>
                )}
              </MenuContent>
            </MenuRoot>
          </span>
        )}
      </div>
      {onFeedback !== undefined && feedback !== undefined && (
        <FeedbackReason feedback={feedback} onFeedback={onFeedback} resolved={resolved} />
      )}
    </footer>
  );
}

function ActionControl({
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
}) {
  const iconOnly = icon !== undefined;
  return (
    <Button
      size="xs"
      variant="ghost"
      iconOnly={iconOnly}
      disabled={disabled}
      aria-label={iconOnly ? label : undefined}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'text-foreground-secondary',
        pressed === true && 'bg-surface-hover text-foreground',
      )}
    >
      {icon ?? label}
    </Button>
  );
}

/** Optional reason for a stored verdict. Enter saves it on top of the current
 *  verdict, and a pending draft survives a failed save. */
function FeedbackReason({
  feedback,
  onFeedback,
  resolved,
}: {
  feedback: { verdict: 'like' | 'dislike'; reason: string | null };
  onFeedback: (verdict: 'like' | 'dislike' | null, reason: string | null) => void;
  resolved: MarkdownLabels;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  return (
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
      className="w-full rounded-sm border border-border-subtle bg-surface-muted px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    />
  );
}
