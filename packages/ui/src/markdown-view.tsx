import * as React from 'react';
import { cn } from './cn';
import { CodeBlock } from './markdown-code';
import { parseMarkdown, type InlineToken, type ListItem, type MarkdownBlock } from './markdown';

/** User-facing strings the renderer needs; the app passes localized copies. */
export interface MarkdownLabels {
  copyCode: string;
  /** Shown for a fenced block that names no language. */
  codeLabel: string;
  copyMessage: string;
  copied: string;
  copyFailed: string;
  imageNotShown: string;
  unsupportedContent: string;
  /** Action that anchors a reply to a message. */
  replyAction: string;
  /** Action that resends a user message as an edited alternative. */
  editAction: string;
  /** Chip marking the branch member the session continues from. */
  branchActiveLabel: string;
  /** Action that makes this branch member the one the session continues from. */
  branchMakeActiveLabel: string;
  /** Heading of the quote block a reply shows. */
  quoteLabel: string;
  /** Heading of the quote block an edited alternative shows. */
  quoteEditedLabel: string;
  /** Shown when the quoted message is outside the loaded history. */
  quoteUnavailable: string;
  /** Verdict action: this answer was liked. */
  likeAction: string;
  /** Verdict action: this answer was disliked. */
  dislikeAction: string;
  /** Label and placeholder of the optional feedback reason field. */
  feedbackReason: string;
  /** Action that asks the model for another answer to the same prompt. */
  regenerateAction: string;
  /** Accessible name of the ⋮ trigger that opens the remaining actions. */
  moreActions: string;
}

export const DEFAULT_MARKDOWN_LABELS: MarkdownLabels = {
  copyCode: 'Copy code',
  codeLabel: 'Code',
  copyMessage: 'Copy message',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  imageNotShown: 'Image not shown',
  unsupportedContent: 'Unsupported content',
  replyAction: 'Reply',
  editAction: 'Edit',
  branchActiveLabel: 'Active',
  branchMakeActiveLabel: 'Make active',
  quoteLabel: 'Replying to',
  quoteEditedLabel: 'Edited from',
  quoteUnavailable: 'Quoted message is not in the loaded history.',
  likeAction: 'Like',
  dislikeAction: 'Dislike',
  feedbackReason: 'Reason (optional)',
  regenerateAction: 'Regenerate',
  moreActions: 'More actions',
};

export function resolveMarkdownLabels(labels?: Partial<MarkdownLabels>): MarkdownLabels {
  return { ...DEFAULT_MARKDOWN_LABELS, ...labels };
}

export interface MarkdownProps {
  /** Raw Markdown source, exactly as received. Rendered, never executed. */
  source: string;
  labels?: Partial<MarkdownLabels>;
  /**
   * Approved external-open handler. Without one, links render as inert text
   * that still shows its target: nothing navigates on its own.
   */
  onOpenLink?: ((url: string) => void) | undefined;
  /** Glyph for the fenced-block copy control; without it the control shows its
   *  word instead (the UI package ships no icon set). */
  copyIcon?: React.ReactNode | undefined;
  /** Keeps code plain until the answer settles, then tokenizes it once. */
  streaming?: boolean | undefined;
  className?: string;
}

/**
 * Renders a Markdown subset as React elements — never as HTML strings, so raw
 * HTML in model output stays visible text. Parsing happens per render, so a
 * partial (streaming) document renders as far as it is complete.
 */
export function Markdown({
  source,
  labels,
  onOpenLink,
  copyIcon,
  streaming,
  className,
}: MarkdownProps) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  const resolved = React.useMemo(() => resolveMarkdownLabels(labels), [labels]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          labels={resolved}
          onOpenLink={onOpenLink}
          copyIcon={copyIcon}
          streaming={streaming}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  labels,
  onOpenLink,
  copyIcon,
  streaming,
}: {
  block: MarkdownBlock;
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
  copyIcon?: React.ReactNode | undefined;
  streaming?: boolean | undefined;
}) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap">
          <InlineView tokens={block.tokens} labels={labels} onOpenLink={onOpenLink} />
        </p>
      );
    case 'heading': {
      const Heading = `h${block.level}` as 'h1';
      return (
        <Heading
          className={cn(
            'mt-2 font-semibold first:mt-0',
            block.level === 1 && 'text-2xl',
            block.level === 2 && 'text-xl',
            block.level === 3 && 'text-lg',
            block.level === 4 && 'text-base',
            block.level >= 5 && 'text-sm text-foreground-secondary',
          )}
        >
          <InlineView tokens={block.tokens} labels={labels} onOpenLink={onOpenLink} />
        </Heading>
      );
    }
    case 'code':
      return (
        <CodeBlock
          source={block.text}
          language={block.language}
          labels={labels}
          copyIcon={copyIcon}
          streaming={streaming}
        />
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cn(
            'flex flex-col gap-2 ps-6 marker:text-foreground-muted',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
          {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}
        >
          {block.items.map((item, index) => (
            <ListItemView
              key={index}
              item={item}
              labels={labels}
              onOpenLink={onOpenLink}
              copyIcon={copyIcon}
              streaming={streaming}
            />
          ))}
        </List>
      );
    }
    case 'quote':
      return (
        <blockquote className="border-s-4 border-border ps-4 text-foreground-secondary">
          <div className="flex flex-col gap-3">
            {block.blocks.map((inner, index) => (
              <BlockView
                key={index}
                block={inner}
                labels={labels}
                onOpenLink={onOpenLink}
                copyIcon={copyIcon}
                streaming={streaming}
              />
            ))}
          </div>
        </blockquote>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="border-b border-border-subtle bg-surface-muted px-3 py-2 text-start align-top font-semibold"
                  >
                    <InlineView tokens={cell} labels={labels} onOpenLink={onOpenLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        'px-3 py-2 text-start align-top',
                        rowIndex > 0 && 'border-t border-border-subtle',
                      )}
                    >
                      <InlineView tokens={cell} labels={labels} onOpenLink={onOpenLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="border-border-subtle" />;
  }
}

function ListItemView({
  item,
  labels,
  onOpenLink,
  copyIcon,
  streaming,
}: {
  item: ListItem;
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
  copyIcon?: React.ReactNode | undefined;
  streaming?: boolean | undefined;
}) {
  return (
    <li className="whitespace-pre-wrap">
      <InlineView tokens={item.tokens} labels={labels} onOpenLink={onOpenLink} />
      {item.blocks.length > 0 && (
        <div className="flex flex-col gap-3 pt-1">
          {item.blocks.map((block, index) => (
            <BlockView
              key={index}
              block={block}
              labels={labels}
              onOpenLink={onOpenLink}
              copyIcon={copyIcon}
              streaming={streaming}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function InlineView({
  tokens,
  labels,
  onOpenLink,
}: {
  tokens: InlineToken[];
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  return (
    <>
      {tokens.map((token, index) => (
        <InlineTokenView key={index} token={token} labels={labels} onOpenLink={onOpenLink} />
      ))}
    </>
  );
}

function InlineTokenView({
  token,
  labels,
  onOpenLink,
}: {
  token: InlineToken;
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  switch (token.kind) {
    case 'text':
      return token.text;
    case 'code':
      return (
        <code className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-sm" dir="ltr">
          {token.text}
        </code>
      );
    case 'strong':
      return (
        <strong className="font-semibold">
          <InlineView tokens={token.tokens} labels={labels} onOpenLink={onOpenLink} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <InlineView tokens={token.tokens} labels={labels} onOpenLink={onOpenLink} />
        </em>
      );
    case 'strike':
      return (
        <s>
          <InlineView tokens={token.tokens} labels={labels} onOpenLink={onOpenLink} />
        </s>
      );
    case 'link':
      return <LinkView token={token} onOpenLink={onOpenLink} />;
    case 'image':
      return (
        <span className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border-subtle bg-surface-muted px-1 align-middle text-xs text-foreground-muted">
          <span>{labels.imageNotShown}</span>
          {token.alt !== '' && <span className="whitespace-pre-wrap">{token.alt}</span>}
          {token.url !== '' && token.url !== token.alt && <span dir="ltr">({token.url})</span>}
        </span>
      );
  }
}

function LinkView({
  token,
  onOpenLink,
}: {
  token: Extract<InlineToken, { kind: 'link' }>;
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  // Only allow-listed schemes become anchors, and only when an approved
  // handler exists — a bare href would let the webview navigate on its own.
  if (token.safe && onOpenLink) {
    return (
      <a
        href={token.url}
        rel="noreferrer noopener"
        className="text-action underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={(event) => {
          event.preventDefault();
          onOpenLink(token.url);
        }}
        onAuxClick={(event) => event.preventDefault()}
      >
        {token.text}
      </a>
    );
  }

  return (
    <span className="text-foreground-secondary">
      {token.text}
      {token.text !== token.url && (
        <span className="text-foreground-muted" dir="ltr">
          {' '}
          ({token.url})
        </span>
      )}
    </span>
  );
}
