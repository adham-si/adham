import * as React from 'react';
import { Highlight } from 'prism-react-renderer';
import { codeTheme, highlightLanguage } from './code-highlight';
import { useClipboardCopy } from './use-clipboard-copy';

/** The subset of renderer labels a code block needs; the app passes localized copies. */
export interface CodeBlockLabels {
  copyCode: string;
  codeLabel: string;
  copied: string;
  copyFailed: string;
}

const PRE_CLASS = 'max-h-[60vh] overflow-auto px-3 py-3 font-mono text-xs leading-5 whitespace-pre';

/**
 * Fenced block. The language label and copy stay available while streaming;
 * token colors wait for settled text so a delta never re-tokenizes the block
 * and no half-highlighted code flashes.
 */
export function CodeBlock({
  source,
  language,
  labels,
  copyIcon,
  streaming,
}: {
  source: string;
  language: string;
  labels: CodeBlockLabels;
  copyIcon?: React.ReactNode | undefined;
  streaming?: boolean | undefined;
}) {
  const { state: copyState, copy } = useClipboardCopy();

  return (
    <figure className="overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-1">
        <span className="font-mono text-xs text-foreground-muted" dir="ltr">
          {language || labels.codeLabel}
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-h-control-sm min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-label={labels.copyCode}
            title={labels.copyCode}
            onClick={() => {
              void copy(source);
            }}
          >
            {copyIcon ?? labels.copyCode}
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
      {streaming ? (
        <pre className={PRE_CLASS} dir="ltr">
          <code>{source}</code>
        </pre>
      ) : (
        <Highlight theme={codeTheme} code={source} language={highlightLanguage(language)}>
          {({ tokens, getTokenProps }) => (
            <pre className={PRE_CLASS} dir="ltr">
              <code>
                {tokens.map((line, lineIndex) => (
                  <React.Fragment key={lineIndex}>
                    {line.map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                    {lineIndex < tokens.length - 1 ? '\n' : null}
                  </React.Fragment>
                ))}
              </code>
            </pre>
          )}
        </Highlight>
      )}
    </figure>
  );
}
