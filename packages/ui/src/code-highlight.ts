import type { PrismTheme } from 'prism-react-renderer';

/**
 * Token colors resolve through `tokens.css`, so light/dark switches with the
 * `.dark` class: the theme object never has to be rebuilt.
 */
export const codeTheme: PrismTheme = {
  plain: { color: 'var(--syntax-plain)', backgroundColor: 'transparent' },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: 'var(--syntax-comment)' },
    },
    { types: ['punctuation'], style: { color: 'var(--syntax-operator)' } },
    {
      types: ['keyword', 'atrule', 'important'],
      style: { color: 'var(--syntax-keyword)' },
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'template-string'],
      style: { color: 'var(--syntax-string)' },
    },
    {
      types: ['function', 'class-name', 'maybe-class-name', 'namespace', 'title'],
      style: { color: 'var(--syntax-function)' },
    },
    {
      types: ['number', 'boolean', 'constant', 'builtin', 'symbol'],
      style: { color: 'var(--syntax-number)' },
    },
    { types: ['tag', 'selector'], style: { color: 'var(--syntax-tag)' } },
    {
      types: ['attr-name', 'property', 'variable'],
      style: { color: 'var(--syntax-property)' },
    },
    { types: ['operator', 'entity', 'url'], style: { color: 'var(--syntax-operator)' } },
  ],
};

/**
 * Fence hints Prism does not resolve on its own. The bundled grammars cover
 * JS/TS, Python, Rust, Go, C/C++, JSON, markup, CSS, YAML, Markdown, SQL,
 * Kotlin, Swift, Objective-C and GraphQL; anything else renders as plain text.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  objc: 'objectivec',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
};

export function highlightLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}
