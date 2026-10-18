import * as React from 'react';
import { cn } from './cn';
import { parseMarkdown, type InlineToken, type ListItem, type MarkdownBlock } from './markdown';
import { useClipboardCopy } from './use-clipboard-copy';

/** User-facing strings the renderer needs; the app passes localized copies. */
export interface MarkdownLabels {
  copyCode: string;
  copyMessage: string;
  copied: string;
  copyFailed: string;
  imageNotShown: string;
  unsupportedContent: string;
  /** Action that anchors a reply to a message. */
  replyAction: string;
  /** Action that resends a user message as an edited alternative. */
  editAction: string;
  /** Heading of the quote block a reply shows. */
  quoteLabel: string;
  /** Heading of the quote block an edited alternative shows. */
  quoteEditedLabel: string;
  /** Shown when the quoted message is outside the loaded history. */
  quoteUnavailable: string;
}

export const DEFAULT_MARKDOWN_LABELS: MarkdownLabels = {
  copyCode: 'Copy code',
  copyMessage: 'Copy message',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  imageNotShown: 'Image not shown',
  unsupportedContent: 'Unsupported content',
  replyAction: 'Reply',
  editAction: 'Edit',
  quoteLabel: 'Replying to',
  quoteEditedLabel: 'Edited from',
  quoteUnavailable: 'Quoted message is not in the loaded history.',
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
  className?: string;
}

/**
 * Renders a Markdown subset as React elements — never as HTML strings, so raw
 * HTML in model output stays visible text. Parsing happens per render, so a
 * partial (streaming) document renders as far as it is complete.
 */
export function Markdown({ source, labels, onOpenLink, className }: MarkdownProps) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  const resolved = React.useMemo(() => resolveMarkdownLabels(labels), [labels]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} labels={resolved} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  labels,
  onOpenLink,
}: {
  block: MarkdownBlock;
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
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
            'font-semibold',
            block.level <= 2 ? 'text-base' : 'text-sm text-foreground-secondary',
          )}
        >
          <InlineView tokens={block.tokens} labels={labels} onOpenLink={onOpenLink} />
        </Heading>
      );
    }
    case 'code':
      return <CodeBlock source={block.text} language={block.language} labels={labels} />;
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cn('flex flex-col gap-1 ps-5', block.ordered ? 'list-decimal' : 'list-disc')}
          {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}
        >
          {block.items.map((item, index) => (
            <ListItemView key={index} item={item} labels={labels} onOpenLink={onOpenLink} />
          ))}
        </List>
      );
    }
    case 'quote':
      return (
        <blockquote className="border-s border-border-strong ps-2 text-foreground-secondary">
          <div className="flex flex-col gap-2">
            {block.blocks.map((inner, index) => (
              <BlockView key={index} block={inner} labels={labels} onOpenLink={onOpenLink} />
            ))}
          </div>
        </blockquote>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="border border-border-subtle px-1 py-0.5 text-start align-top font-semibold"
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
                      className="border border-border-subtle px-1 py-0.5 text-start align-top"
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
}: {
  item: ListItem;
  labels: MarkdownLabels;
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  return (
    <li className="whitespace-pre-wrap">
      <InlineView tokens={item.tokens} labels={labels} onOpenLink={onOpenLink} />
      {item.blocks.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          {item.blocks.map((block, index) => (
            <BlockView key={index} block={block} labels={labels} onOpenLink={onOpenLink} />
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
        <code className="rounded-xs bg-surface-muted px-1 font-mono text-xs" dir="ltr">
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
        className="text-action underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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

function CodeBlock({
  source,
  language,
  labels,
}: {
  source: string;
  language: string;
  labels: MarkdownLabels;
}) {
  const { state: copyState, copy } = useClipboardCopy();

  return (
    <figure className="overflow-hidden rounded-md border border-border-subtle bg-surface-subtle">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border-subtle px-2 py-1">
        <span className="font-mono text-xs text-foreground-muted" dir="ltr">
          {language}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-sm px-1 text-xs text-foreground-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => {
              void copy(source);
            }}
          >
            {labels.copyCode}
          </button>
          <span role="status" className="text-xs text-foreground-muted">
            {copyState === 'copied'
              ? labels.copied
              : copyState === 'failed'
                ? labels.copyFailed
                : ''}
          </span>
        </span>
      </figcaption>
      <pre className="overflow-x-auto p-2 text-xs" dir="ltr">
        <code className="font-mono">{source}</code>
      </pre>
    </figure>
  );
}
