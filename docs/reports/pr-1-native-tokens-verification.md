# PR 1 Verification Report — Native Token Foundation

- **Branch:** `refactor/frontend-native-tokens`
- **Draft PR:** [#6](https://github.com/adham-si/adham/pull/6) targeting `main`
- **Parent SHA:** `237720e665a925f5744da1045356d37a996aae3e`
- **Implementation Commit:** `f7647a6fe94ab4eaf5c8f9b1342f208533cbb9cd`
- **Documentation Update Commit:** `e3b234a166c277a4f2e09dba304e8fe0e0c489a1`
- **GitHub CI Run:** [Run 38065240679 / Job 114251438370](https://github.com/adham-si/adham/actions/runs/38065240679/job/114251438370) (Status: SUCCESS on `e3b234a`)
- **Data scope:** Synthetic canary data only

---

## 1. Scope & Objective

PR 1 implements the first step of the approved frontend styling migration:
1. Decouple `packages/design-tokens/tokens.css` into pure native CSS custom properties (`:root` base scales, `:root` light scheme, `.dark` dark scheme, accessibility media queries).
2. Isolate temporary Tailwind v4 mappings into `packages/design-tokens/tailwind-bridge.css` (`@theme`, `@custom-variant dark`, `@theme inline`).
3. Retain existing token names, values, and utility classes so that unmigrated components continue functioning without disruption ahead of PR 2.

---

## 2. Documentation of TypeScript Build Fix

### Issue Encountered on `main`
Running `pnpm --filter @adham/desktop build` (`tsc --noEmit && vite build`) failed with:
```text
src/features/conversation/conversation-test-utils.ts:3:17 - error TS2883:
The inferred type of 'fakeBackend' cannot be named without a reference to
'Procedure' from '../../../node_modules/vitest/dist/chunks/config.d.BxjInJat'.
This is likely not portable. A type annotation is necessary.
```

### Root Cause
`apps/desktop/tsconfig.json` extended `@adham/tsconfig/base.json`, which specifies `"declaration": true` for monorepo packages. Because `apps/desktop` is a client application bundle built with Vite (not a published npm library emitting `.d.ts` declaration files for downstream consumers), enforcing declaration file constraints on application source and test helpers triggered TS2883 portable-type checks.

### Resolution
Configured `"declaration": false` and `"declarationMap": false` in `apps/desktop/tsconfig.json` (matching the repository root `tsconfig.json`).
This cleanly unblocks `pnpm --filter @adham/desktop build` without introducing artificial type dependencies or modifying test utility implementation code.

---

## 3. Tier-1 Mapping Claim Correction

### Historical Claim
Earlier architecture notes (P0-06) asserted:
> *"tier-1 scales are aliased into `--spacing-*` / `--z-index-*`, which is what makes `min-h-control-md`, `size-icon-md` and `z-dialog` real utilities rather than inert variables."*

### Technical Correction
1. **Namespace Specificity:** Tailwind v4 only emits utility classes for recognized theme namespaces:
   - `--spacing-*` → `min-h-*`, `h-*`, `w-*`, `p-*`, `m-*`, `gap-*`, `size-*`
   - `--radius-*` → `rounded-*`
   - `--color-*` → `bg-*`, `text-*`, `border-*`, `outline-*`
   - `--z-index-*` → `z-*`
2. **`--space-*` is NOT a Tailwind namespace:** The base spacing scale (`--space-1` … `--space-10`) in `@theme` was never aliased into `--spacing-*`, so Tailwind v4 never generated utilities like `p-space-1`. Callers use native `var(--space-*)` or default Tailwind spacing utilities (`p-1`, `p-2`, etc.).
3. **`--radius-*` bridging:** In the original `tokens.css`, `--radius-*` lived directly inside `@theme`, generating `rounded-sm`, `rounded-md`, etc. When `--radius-*` is moved to native `:root`, it must be explicitly bridged in `tailwind-bridge.css` under `@theme inline` (`--radius-md: var(--radius-md)`) so Tailwind continues emitting the required `rounded-*` utility classes for existing components until PR 2.

---

## 4. CSS Utility & Declaration Rule Parity

### Comparison Methodology
To evaluate the impact on compiled styles, the desktop renderer CSS bundle was compiled under two configurations:
1. **Parent-CSS Configuration:** `tokens.css` and `index.css` from parent revision `237720e`.
2. **PR 1 Branch Configuration:** Native `tokens.css` + `tailwind-bridge.css` on `refactor/frontend-native-tokens`.

### Selector Presence
- **Parent Unique Selectors:** 429
- **Branch Unique Selectors:** 429 (+ 3 duration tokens preserved from `:root` by lightningcss)
- **Missing Utility Selectors Detected:** **0**

### Rule Declaration Inspection
Inspecting the compiled rules confirms that Tailwind v4 emits identical CSS property declarations referencing the same custom properties:

| Utility Class | Parent Rule Declaration | PR 1 Rule Declaration | Resolved Value |
|---|---|---|---|
| `.rounded-md` | `border-radius: var(--radius-md)` | `border-radius: var(--radius-md)` | `6px` |
| `.rounded-lg` | `border-radius: var(--radius-lg)` | `border-radius: var(--radius-lg)` | `8px` |
| `.min-h-control-md` | `min-height: var(--control-md)` | `min-height: var(--control-md)` | `36px` |
| `.size-icon-md` | `width: var(--icon-md); height: var(--icon-md)` | `width: var(--icon-md); height: var(--icon-md)` | `20px` |
| `.z-dialog` | `z-index: var(--z-dialog)` | `z-index: var(--z-dialog)` | `400` |
| `.z-menu` | `z-index: var(--z-menu)` | `z-index: var(--z-menu)` | `500` |
| `.bg-surface` | `background-color: var(--surface)` | `background-color: var(--surface)` | `#ffffff` (light) / `#16161c` (dark) |
| `.text-foreground` | `color: var(--foreground)` | `color: var(--foreground)` | `#121214` (light) / `#f4f4f6` (dark) |
| `.border-border` | `border-color: var(--border)` | `border-color: var(--border)` | `#8a8a96` (light) / `#6a6a80` (dark) |
| `.shadow-floating` | `--tw-shadow: var(--shadow-floating); box-shadow: ...` | `--tw-shadow: var(--shadow-floating); box-shadow: ...` | `0 1px 2px rgb(...) 0 4px 12px rgb(...)` |

**Note on Visual Parity:**
While the selector and declaration inspections prove that identical CSS rules are emitted by Tailwind v4, full rendering verification requires interactive computed-style checks in a running desktop/browser environment.

---

## 5. Automated Gates Evidence

Local execution at current working revision:

```bash
$ pnpm format:check
Checked 189 files in 27ms. No fixes applied.

$ pnpm lint
Found 0 warnings and 0 errors. Finished in 11ms on 171 files with 96 rules.

$ pnpm check
Test Files  22 passed (22)
Tests       350 passed (350)
Duration    4.41s

$ pnpm check:magic-values
Magic-value check passed: 25/25 cases passed.

$ pnpm check:deny-exceptions
deny exceptions ok: 22/22 cases passed.

$ pnpm --filter @adham/desktop build
vite v8.3.3 building client environment for production...
dist/index.html                   0.79 kB │ gzip:   0.47 kB
dist/assets/index-XbnZ33IN.css   47.95 kB │ gzip:   8.95 kB
dist/assets/routes-MOPfAmXV.js  302.17 kB │ gzip:  70.42 kB
dist/assets/index-DbJYXgJW.js   468.22 kB │ gzip: 146.70 kB
✓ built in 327ms

$ cargo test --workspace
test result: ok across all workspace crates (core-types, runtime, verify, projections, provider, desktop-api, platform).
```

---

## 6. Visual / Native Acceptance Check Status

1. **Automated Unit & Contrast Tests:** All 19 tests in `packages/design-tokens/src/tokens.test.ts` pass, verifying:
   - Light and dark theme variable declaration parity.
   - WCAG contrast >= 4.5:1 for body text on all surfaces across light and dark themes.
   - Reduced motion overrides (`--duration-*: 0ms`).
   - Forced colors high-contrast system overrides.
2. **Browser Subagent / Automated Headless Verification:**
   - Attempted running browser verification against `http://localhost:11111/gallery`.
   - Tool execution failed due to an external Playwright driver CDN issue:
     `could not install driver: got non 200 status code: 404 from https://playwright.azureedge.net/builds/driver/playwright-1.57.0-mac-arm64.zip`.
3. **Rust & Tauri Host Status:**
   - `cargo check --workspace`: Passed (26s).
   - `cargo test --workspace`: Passed (all crates).
   - Live native Tauri launch requires user interaction / local verification.
