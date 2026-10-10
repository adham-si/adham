# PR 1 Verification Report — Native Token Foundation

- **Branch:** `refactor/frontend-native-tokens`
- **Draft PR:** [#6](https://github.com/adham-si/adham/pull/6) targeting `main`
- **Parent Base SHA:** `237720e665a925f5744da1045356d37a996aae3e`
- **Merged Head SHA:** `2158296 (integrated origin/main at b01d84d)`
- **Initial Implementation Commit:** `f7647a6fe94ab4eaf5c8f9b1342f208533cbb9cd`
- **Documentation Update Commit:** `e3b234a166c277a4f2e09dba304e8fe0e0c489a1`
- **Evidence Refinement Commit:** `a922a068b090d10c482bc539993400a2b2263097`
- **GitHub CI Runs:**
  - Run 38065240679 / Job 114251438370: SUCCESS (head `e3b234a`)
  - Run 38066183117: SUCCESS (head `a922a06`)
- **Data scope:** Synthetic canary data only

---

## 1. Scope & Objective

PR 1 implements the first step of the approved frontend styling migration:
1. Decouple `packages/design-tokens/tokens.css` into pure native CSS custom properties (`:root` base scales, `:root` light scheme, `.dark` dark scheme, accessibility media queries).
2. Isolate temporary Tailwind v4 mappings into `packages/design-tokens/tailwind-bridge.css` (`@theme`, `@custom-variant dark`, `@theme inline`).
3. Retain existing token names, values, and utility classes so that unmigrated components continue functioning without disruption ahead of PR 2.

---

## 2. Documentation of TypeScript Build Fix & Upstream Resolution

### Initial Issue on `main` (`237720e`)
Running `pnpm --filter @adham/desktop build` (`tsc --noEmit && vite build`) failed with:
```text
src/features/conversation/conversation-test-utils.ts:3:17 - error TS2883:
The inferred type of 'fakeBackend' cannot be named without a reference to
'Procedure' from '../../../node_modules/vitest/dist/chunks/config.d.BxjInJat'.
This is likely not portable. A type annotation is necessary.
```

### Upstream Integration
PR #7 (`bdfb466`, merged into `main` at `b01d84d`) resolved this issue upstream by defining explicit public `Mock` types on `ConversationFakeBackend` in `conversation-test-utils.ts`. 
Following integration of `origin/main` into `refactor/frontend-native-tokens`, `apps/desktop/tsconfig.json` maintains the standard `@adham/tsconfig/base.json` contract (`declaration: true`), and `pnpm --filter @adham/desktop build` compiles cleanly with zero errors.

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

### Representative Rule Declaration Inspection
Inspecting compiled rules confirms that Tailwind v4 emits identical CSS property declarations referencing the exact same custom properties across representative scales, colors, boundaries, and overlays:

| Utility Class | Parent Rule Declaration | PR 1 Rule Declaration | Expected Token Value (Design System Contract) |
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

*Scope notice: The above table captures representative core utilities; it is not an exhaustive dump of every CSS rule in the application.*

---

## 5. Automated Gates Evidence (at Current Merged Head)

```bash
$ pnpm format:check
Checked 189 files in 28ms. No fixes applied.

$ pnpm lint
Found 0 warnings and 0 errors. Finished in 11ms on 171 files with 96 rules.

$ pnpm check
Test Files  22 passed (22)
Tests       352 passed (352)
Duration    4.2s

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
✓ built in 330ms

$ cargo test --workspace
test result: ok across all workspace crates (core-types, runtime, verify, projections, provider, desktop-api, platform).
```

---

## 6. Visual / Native Acceptance Check Status

1. **Automated Unit, Parity & Contrast Tests:** All 21 tests in `packages/design-tokens/src/tokens.test.ts` pass, including:
   - Light and dark theme variable declaration parity.
   - WCAG contrast >= 4.5:1 for body text on all surfaces across light and dark themes.
   - Explicit assertions for `prefers-reduced-motion: reduce` overrides (`--duration-*: 0ms`).
   - Explicit assertions for `forced-colors: active` high-contrast system colors.
2. **Browser Subagent Status:**
   - Attempted running headless browser verification against `http://localhost:11111/gallery`.
   - Tool execution failed due to an external Playwright driver CDN issue:
     `could not install driver: got non 200 status code: 404 from https://playwright.azureedge.net/builds/driver/playwright-1.57.0-mac-arm64.zip`.
3. **Rust & Tauri Host Status:**
   - `cargo check --workspace`: Passed.
   - `cargo test --workspace`: Passed.
4. **Manual Native Verification Checklist (Host: macOS arm64, Head: `6d87a48`):**

| Check | Expected Result | Status | Notes |
|---|---|---|---|
| Light / Dark / System appearance | Colors render according to theme; System tracks OS changes | **PENDING** | Manual verification via `tauri dev` |
| Cold restart in dark mode | Initial paint uses dark tokens without light-theme flash | **PENDING** | Manual verification via `tauri dev` |
| Buttons & inputs | Preserves radius (`6px`), padding, heights (`32/36/40px`), and focus ring | **PENDING** | Manual verification via `tauri dev` |
| Dialogs & menus | Proper z-index stacking (`400/500`) and floating box-shadow | **PENDING** | Manual verification via `tauri dev` |
| Arabic / RTL layout | Correct alignment, text direction, and logical margins/padding | **PENDING** | Manual verification via `tauri dev` |
| Reduced motion | Token-controlled animations/transitions disabled (`0ms`) | **PENDING** | Media query override verified in tokens test; runtime visual pending |
| Forced colors / High contrast | Controls, borders, and focus rings remain distinct | **PENDING** | System palette overrides verified in tokens test; runtime visual pending |

*Notice: Per project review policy, visual acceptance checks are explicitly tracked as pending manual confirmation. None are marked passed without live screen verification.*
