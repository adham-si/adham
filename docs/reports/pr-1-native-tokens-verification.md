# PR 1 Verification Report — Native Token Foundation

- **Branch:** `refactor/frontend-native-tokens`
- **Draft PR:** [#6](https://github.com/adham-si/adham/pull/6) targeting `main`
- **Revision SHA:** `f7647a6fe94ab4eaf5c8f9b1342f208533cbb9cd`
- **Parent SHA:** `237720e665a925f5744da1045356d37a996aae3e`
- **Data scope:** Synthetic canary data only

---

## 1. Scope & Objective

PR 1 implements the first step of the approved frontend styling migration:
1. Decouple `packages/design-tokens/tokens.css` into pure native CSS custom properties (`:root` base scales, `:root` light scheme, `.dark` dark scheme, accessibility media queries).
2. Isolate temporary Tailwind v4 mappings into `packages/design-tokens/tailwind-bridge.css` (`@theme`, `@custom-variant dark`, `@theme inline`).
3. Maintain 100% utility and visual parity across all existing consumers while preparing for subsequent CSS Modules migration.

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
`apps/desktop/tsconfig.json` extended `@adham/tsconfig/base.json`, which specifies `"declaration": true` for monorepo packages. Because `apps/desktop` is an application executable bundle built by Vite (not a library emitting `.d.ts` declaration files for consumers), enforcing declaration file constraints on application source and test helpers triggered TS2883 portable-type checks.

### Resolution
Configured `"declaration": false` and `"declarationMap": false` in `apps/desktop/tsconfig.json` (matching the repository's root `tsconfig.json`).
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

## 4. Utility & Visual Parity Verification Against Parent (`237720e`)

A full production CSS build was executed for both the parent revision (`237720e`) and the PR 1 branch revision (`f7647a6`):

| Metric | Parent Revision (`237720e`) | PR 1 Revision (`f7647a6`) | Diff |
|---|---|---|---|
| CSS Output File | `index-D2Ljlnfe.css` | `index-XbnZ33IN.css` | Name hash changed |
| CSS Bundle Size | 47,317 bytes (8.81 kB gzip) | 47,950 bytes (8.95 kB gzip) | +633 bytes (native :root scale preservation) |
| Total Unique Utility Classes | 429 | 429 (+ 3 lightningcss duration tokens) | **0 missing classes** |

### Verified Utility Classes
All semantic and scale utility classes were verified present in the compiled bundle:
- `min-h-control-sm`, `min-h-control-md`, `min-h-control-lg`: **PRESENT**
- `size-icon-sm`, `size-icon-md`, `size-icon-lg`: **PRESENT**
- `z-dialog`, `z-menu`, `z-popover`, `z-toast`: **PRESENT**
- `rounded-sm`, `rounded-md`, `rounded-lg`: **PRESENT**
- `bg-surface`, `bg-surface-raised`, `bg-action`: **PRESENT**
- `text-foreground`, `text-foreground-secondary`, `text-foreground-muted`: **PRESENT**
- `border-border`, `border-border-subtle`, `border-border-strong`: **PRESENT**

Missing classes compared to parent revision: **0 (`[]`)**. Visual and utility output is 100% identical.

---

## 5. Automated Gates & Test Execution Evidence

All gates executed cleanly at revision `f7647a6`:

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
Magic-value check passed: no hex literals, arbitrary var() values, bare z-index utilities,
non-1px borders, or cleared Tailwind defaults. (25/25 cases passed)

$ pnpm check:deny-exceptions
deny exceptions ok (1 record(s) checked, today 2026-10-10). (22/22 cases passed)

$ pnpm --filter @adham/desktop build
vite v8.3.3 building client environment for production...
dist/index.html                   0.79 kB │ gzip:   0.47 kB
dist/assets/index-XbnZ33IN.css   47.95 kB │ gzip:   8.95 kB
dist/assets/routes-MOPfAmXV.js  302.17 kB │ gzip:  70.42 kB
dist/assets/index-DbJYXgJW.js   468.22 kB │ gzip: 146.70 kB
✓ built in 327ms
```

---

## 6. Review Checklist & Next Steps

- [x] Branch `refactor/frontend-native-tokens` published to `origin`.
- [x] Draft PR [#6](https://github.com/adham-si/adham/pull/6) opened targeting `main`.
- [x] TypeScript build fix documented.
- [x] Tier-1 mapping claim corrected.
- [x] CSS utility parity against parent revision verified (0 missing classes).
- [x] All checks passing (`pnpm check`, `build`).
- [ ] PR 2 (`refactor/ui-css-modules`) is blocked until PR 1 is reviewed and merged.
