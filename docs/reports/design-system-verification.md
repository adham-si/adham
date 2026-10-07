# Design system — browser verification

Date: 2026-10-07
Branch: `feat/design-system`
Scope: Tasks 11–12 verification against a running Vite dev server.

Synthetic canary content only. No user content, secrets, key material or raw app-data paths
appear in this report.

## Status: PARTIAL

Task 13 could not be completed honestly. The dev server serving port 11111 was started at
01:39, before the token and component work landed, so it serves a stale stylesheet.

Probing the live page confirms it. Checking the served CSS for the utilities this branch
introduces:

| Utility | Present in served CSS |
|---|---|
| `text-foreground-muted` | yes |
| `border-border-subtle` | yes |
| `min-h-control-md` | **no** |
| `min-h-control-sm` | **no** |
| `min-h-control-lg` | **no** |
| `size-icon-md` | **no** |
| `z-dialog` | **no** |
| `z-menu` | **no** |
| `rounded-md` | **no** |
| `bg-surface` | **no** |
| `bg-scrim` | **no** |

The first two are used by the pre-token seeded markup; the rest are used by the new
components. That split is the signature of stale CSS, not of missing utilities — the same
utilities were confirmed present in a fresh `vite build` during Task 3.

Live computed values agree: `getComputedStyle(textarea).minHeight` is `0px` and
`min-h-control-md` is never applied, because the class is not in the served stylesheet.

## Verified

Probed against `http://localhost:11111`.

| Check | Result |
|---|---|
| `--background` resolves | `#fafafa` |
| `--foreground` resolves | `#121214` |
| dead `--color-bg-canvas` removed | resolves empty, so the tier rewrite took effect |
| `body` background follows the token | `rgb(250, 250, 250)` |
| `index.html` loads the external no-flash script | yes |
| `index.html` inline `<script>` count | 0 — `script-src 'self'` is not violated |
| `<html>` after pre-paint script | `class=""`, `lang="en"`, `dir="ltr"` |

## Not verified — requires a dev server restart

| Check | Method |
|---|---|
| forced colours | emulate `forced-colors: active`; assert focus and selected resolve to a non-`transparent` outline/background |
| 200% text scaling | set root font-size to 200%; assert `scrollHeight <= clientHeight + 1` for Button, Input, SidebarItem |
| visual sweep | capture button, input, sidebar item, menu, dialog and message in light and dark |

## Console error, not a defect

On load: `TypeError: Cannot read properties of undefined (reading 'invoke')` from
`AdhamApiClient.createWorkspace`.

This is the Tauri IPC bridge being absent in a plain browser tab. The P0-04 client calls
`invoke` directly, and `window.__TAURI_INTERNALS__` does not exist outside the Tauri webview.
Nothing in this branch changed that path.

## Procedure to complete

1. Restart the dev server on port 11111 (`pnpm --filter @adham/desktop dev`), or run
   `pnpm tauri dev` for the real webview.
2. Re-run the three checks above.
3. Replace this report with the results, and mark Task 13 complete.

## Files not touched

`crates/adham-*/` and `Cargo.toml` belong to the teammate's concurrent P0-09 through P0-13
work and were excluded from this branch entirely. No Rust verification was run on it.