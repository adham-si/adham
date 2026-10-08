# Design system — browser verification

Date: 2026-10-07
Branch: `feat/design-system`
Scope: Tasks 11–13, verified in a real browser against `pnpm --filter @adham/desktop dev`.

Synthetic canary content only. No user content, secrets, key material or raw app-data paths
appear in this report.

## Result: PASS

A real defect was found and fixed during this pass. It is described first because it
invalidate anything verified before it.

## Defect found: the shared package was never scanned

**Symptom.** Component classes were absent from the served CSS. `min-h-control-*`,
`size-icon-*`, `z-dialog`, `z-menu`, `bg-action`, `bg-scrim`, `outline-focus`, `ps-3`/`pe-3`
were all missing. Nothing failed; every test still passed.

**First hypothesis, and why it was wrong.** A dev server started at 01:39 predated the work,
so stale CSS seemed the obvious cause. Restarting it changed nothing — which disproved the
theory rather than confirming it.

**Actual cause.** Tailwind v4 only auto-detects sources under the directory holding the CSS
entry. `apps/desktop/src/styles/index.css` therefore never scanned `packages/ui`, a sibling
workspace package. Every class used *only* in `packages/ui` was missing; every class used in
`apps/desktop` was present. That correlation is the signature.

**Fix.** Explicit `@source` directives in `apps/desktop/src/styles/index.css`:

```css
@source "../../../../packages/ui/src";
@source "../../../../packages/design-tokens/src";
```

Four levels, not three: the file sits at `apps/desktop/src/styles/`, so `styles → src →
desktop → apps → root`. A first attempt used three and resolved to `apps/packages/ui`.

**Regression guard.** `routes-migration.test.ts` now asserts each `@source` resolves to an
existing directory *and* that the expected file is inside it, so a depth mistake cannot pass.
The same class of bug — content assumed to be scanned — had already slipped through the
contrast tests, which read `tokens.css` directly and never build.

## Utilities present in the built CSS

Verified with `vite build`, then confirmed live in the browser: **24 / 24**.

`min-h-control-sm|md|lg`, `size-icon-sm|md|lg`, `z-dialog`, `z-menu`, `rounded-md`,
`rounded-lg`, `bg-surface`, `bg-surface-subtle`, `bg-surface-muted`, `bg-selection`,
`text-foreground-muted`, `border-border-subtle`, `border-border`, `bg-scrim`, `ps-3`, `pe-3`,
`end-3`, `bg-action`, `text-action-foreground`, `outline-focus`.

`z-popover` and `z-toast` are defined but not emitted: no source file uses them yet.
Tailwind correctly omits unused utilities. They will appear when a Popover or Toast lands.

## 200% text scaling — no clipping

Root font-size set to 200%, probe controls constrained to 180px so text genuinely wraps
(buttons otherwise size to content and the test is meaningless).

| Control | min-height | scrollHeight | clientHeight | Clipped |
|---|---|---|---|---|
| `min-h-control-sm` | 32px | 472 | 472 | **no** |
| `min-h-control-md` | 36px | 472 | 472 | **no** |
| `min-h-control-lg` | 40px | 472 | 472 | **no** |

All three satisfy `scrollHeight <= clientHeight + 1`. The control grows with the text, which
is the spec requirement: a control height is a baseline, not a reason to clip.

A fixed `h-9` / `h-10` control was probed as a control case and did **not** clip in this
harness either, because `<button>` with `display:block` expands regardless. That comparison is
therefore inconclusive and is not claimed as evidence; the `min-h-*` results above stand on
their own.

## Forced colours (Windows High Contrast)

`forced-colors: active` emulated. Both states the spec calls out survive.

Token resolution:

| Token | Resolves to |
|---|---|
| `--background` | `Canvas` |
| `--foreground` | `CanvasText` |
| `--focus` | `Highlight` |
| `--selection` | `Highlight` |
| `--accent` | `LinkText` |

Selected state (`bg-selection`): background resolves to a non-transparent colour.

Focus ring, focused by real keyboard input so `:focus-visible` genuinely matches:

| Property | Value |
|---|---|
| `matches(':focus-visible')` | `true` |
| `outline-style` | `solid` |
| `outline-width` | `2px` |
| `outline-color` | non-transparent |
| `outline-offset` | `2px` |

The first focus probe read `outline-style: none` because the element had never been focused —
an invalid test, not a failure. Re-run with `Tab`/`Shift+Tab` it resolves correctly.

## Light and dark

Both captured (`screenshots/light.png`, `screenshots/dark.png`).

| | light | dark |
|---|---|---|
| `<html>` class | `""` | `"dark"` |
| `--background` | `#fafafa` | `#0e0e11` |
| `--foreground` | `#121214` | `#f4f4f6` |
| `--surface` | `#ffffff` | `#16161c` |
| `--action` | `#2b2bff` | `#3d3dff` |
| `body` background | `rgb(250,250,250)` | `rgb(14,14,17)` |
| `color-scheme` | `light` | `dark` |

The `dark` class is applied by `no-flash-theme.js` before React mounts, from
`localStorage['adham.appearance']`. `color-scheme` follows, so native scrollbars, form
controls and the caret track the theme.

## RTL

| `dir` | padding-left | padding-right |
|---|---|---|
| `ltr` | 0px | 8px |
| `rtl` | 8px | 0px |

`ps-*` / `pe-*` mirror correctly. No direction-locked utility appears anywhere in the live
DOM.

## CSP

The no-flash script is external and non-deferred, referenced from `<head>`.

**Production build: 0 inline scripts.** Only `/no-flash-theme.js` and the bundled module.
`script-src 'self'` holds.

Dev mode shows one inline `<script type="module">` — Vite's React Fast Refresh preamble,
injected by the plugin and absent from the build. Not a CSP concern for the shipped app.

## Console

One error on load: `TypeError: Cannot read properties of undefined (reading 'invoke')` from
`AdhamApiClient.createWorkspace`. This is the Tauri IPC bridge being absent in a plain browser
tab — `window.__TAURI_INTERNALS__` does not exist outside the Tauri webview. Pre-existing from
P0-04, not introduced here. A final pass should run under `pnpm tauri dev`.

## Not covered

The live route currently renders the concurrent workspace UI, not every component in
`packages/ui`, so Button, Menu, Dialog, MessageCard, SidebarItem and AdhamIcon were verified at
the token-and-CSS layer (their utilities, focus, forced colours, RTL) rather than through their
rendered output. Their state behaviour is covered by 216 unit tests. A component gallery route
would close this properly and is worth doing.

`crates/adham-*/` and `Cargo.toml` belong to concurrent P0 work and were not touched. No Rust
verification was run on them.