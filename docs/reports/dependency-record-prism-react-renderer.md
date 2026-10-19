# Dependency record — `prism-react-renderer`

**Date:** 2026-10-19  
**Decision:** accepted for fenced-code syntax highlighting in conversation answers  
**Human approval:** operator selected `prism-react-renderer` on 2026-10-19 (other candidates: `shiki`, `highlight.js`, plain monospace)

## Section 9 record

| Field | Record |
|---|---|
| Purpose and owner | Color fenced code blocks rendered by `packages/ui/src/markdown-code.tsx`. Owner: conversation rendering (`packages/ui`). Not used for user content outside Markdown fences. |
| Package and version | `prism-react-renderer@2.4.1` (range `^2.4.1`), added to `@adham/ui` (`packages/ui/package.json`). |
| License | MIT (package manifest and `LICENSE` in the package). |
| Maintenance activity | Latest published release at install time: `2.4.1`; registry metadata modified 2026-07-20. Repository: `github.com/FormidableLabs/prism-react-renderer`. |
| Security history | OSV query for the npm package returned no advisories on 2026-10-19. Re-check when upgrading. |
| Transitive dependency impact | Declares `clsx@^2.0.0` (already a direct dependency of `@adham/ui`; resolves to the same copy) and `@types/prismjs@^1.26.0` (type declarations only). No native modules, no install scripts. |
| Native build implications | None — pure JavaScript executed in the webview. |
| Cross-platform support | Browser/WebView standard APIs only; no platform-specific code. Works on macOS, Windows and Linux targets. |
| Standard-library sufficiency | No standard-library tokenizer exists; the dependency-free alternative is the previous plain monospace block, which stays the fallback for unknown languages. |
| Exit strategy | Rendering is isolated to `markdown-code.tsx` and `code-highlight.ts`; colors are nine `--syntax-*` CSS variables. Removing the package restores `<pre><code>` without touching stored data — messages persist Markdown source, not highlighted markup. |

## Grammar coverage and limits

Bundled grammars cover TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, C/C++,
JSON, HTML/XML/markup, CSS, YAML, Markdown, SQL, Kotlin, Swift, Objective-C,
GraphQL, CoffeeScript and Reason. Fence hints outside the bundle (for example
`bash`, `ruby`, `java`, `csharp`) render as plain text with the language label
intact — never as fabricated highlighting. Streaming blocks stay plain and are
tokenized once when the answer settles.

## Palette

The theme resolves CSS variables rather than fixed colors, so the `.dark` class
switches palettes without re-rendering:

- Light: GitHub light palette (`--syntax-comment` darkened from `#6e7781` to
  `#57606a` so comments clear 4.5:1 on `--surface-subtle`).
- Dark: GitHub dark palette.

Token values live in `packages/design-tokens/tokens.css`; the Tailwind bridge
and `SEMANTIC_VARS` mirror was updated so every runtime token has a utility.
