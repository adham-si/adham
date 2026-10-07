# Design Token System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Adham's flat, fixed-value token collection with a three-tier semantic token system, ship six state-complete components, and add class-based theme switching — with contrast, parity and magic-value enforcement as tests.

**Architecture:** CSS is the single source of truth (`packages/design-tokens/tokens.css`): tier 1 primitives never change, tier 2 purpose-named runtime vars are the only thing `.dark` redefines, tier 3 `@theme inline` maps them into Tailwind utilities. Components compose CVA variants through `cn()`. The app migrates from `var(--x, #hex)` arbitrary values to semantic utilities.

**Tech Stack:** Tailwind CSS v4 (`@theme`, `@theme inline`, `@custom-variant dark`), React 19, TypeScript 7 strict, Vitest + Testing Library, CVA + clsx + tailwind-merge, Playwright (browser checks).

**Spec:** `docs/superpowers/specs/2026-10-07-design-token-system-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Approved dependencies, nothing else: `class-variance-authority`, `clsx`, `tailwind-merge` (`docs/reports/dependency-proposal.md` §2.3). No icon package, no `@floating-ui/react`, no `radix-ui`.
- File-size: target <300 lines, review >400, >600 needs a documented exception. Functions <40 lines.
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Lint/format: Oxlint + Biome only. Biome's linter is **disabled** (`biome.json`); it is formatting-only.
- Only `apps/desktop/src/shared/api/adham-client.ts` may import `@tauri-apps/api/core`.
- All user-visible text goes through i18n from day 1. No hardcoded UI strings.
- Commit `routeTree.gen.ts`; never hand-edit it. Never `git push` without asking.
- Reports and docs use synthetic canary data only — never user content, secrets or raw app-data paths.
- Radius: `md` = **6px** (corrects the current 8px). Control heights: sm **32** / md **36** / lg **40**, applied as `min-h-control-*` + padding, never a fixed `h-*`.
- Contrast: ≥4.5:1 body text, ≥3:1 large text and control boundaries, in **both** themes.
- Z-order: `--z-dialog 400`, `--z-menu 500`, `--z-popover 500`, `--z-toast 700`.
- RTL: logical properties only (`ps-/pe-/ms-/me-/start-/end-/text-start/rounded-s-`). No `left-`, `right-`, `pr-`, `ml-`, `mr-`.
- Do not modify code you did not write when you find it broken — report it instead (see Report-Only Findings).

## Report-Only Findings

These are pre-existing defects in teammate-owned files. **Do not fix them inside this plan.** Report them to the human partner.

1. `apps/desktop/vite.config.ts:19` sets `server.port: 5173`, but `apps/desktop/src-tauri/tauri.conf.json` sets `devUrl: "http://localhost:1420"` — `tauri dev` cannot connect.
2. `apps/desktop/src/routes/index.tsx:82` renders English prose inline instead of an i18n key.
3. `packages/ui/src/button.test.tsx` imports `@testing-library/react`, but `packages/ui/package.json` declares no devDependencies. Under pnpm's isolated linker that import may not resolve. Task 3 places the already-approved packages; if the test failed *before* Task 3, record that as a pre-existing failure.

## Review Focus

1. **RTL/Arabic layout.** A direction-locked utility (`pr-24`, `right-3`, `ml-*`) silently mirrors wrong in Arabic. Test: render under `dir="rtl"` and assert no direction-locked utility appears in the output class string — owned by Task 12.
2. **200% text scaling.** A fixed `h-control-md` clips wrapped text, which the spec forbids ("a baseline, not a reason to clip"). Test: set root font-size 200% in the browser and assert `scrollHeight <= clientHeight` for each control — owned by Task 13.
3. **Forced colors (Windows High Contrast).** Focus and selected states disappear without system-color fallbacks, and this is a Windows-first app. Test: emulate `forced-colors: active` and assert focus/selected still resolve to a non-`transparent` outline/background — owned by Task 13.
4. **No-flash script blocked by CSP.** `script-src 'self'` has no `'unsafe-inline'`, so an inline script never runs and the theme flashes. Test: assert `index.html` contains **no** inline `<script>` (only `src=` references) — owned by Task 11.
5. **Caller `className` silently lost.** Without `tailwind-merge`, a caller's `p-8` loses to the component's base padding. Test: render with `className="p-8"` and assert the rendered class contains `p-8` and not the base padding utility — owned by Task 3.
6. **Dark-mode contrast regression.** A hand-edit to any tier-2 value can drop below AA unnoticed. Test: the full pairing matrix re-runs on every `pnpm test` — owned by Task 1.

---

## File Structure

```
packages/design-tokens/
  tokens.css              three tiers, single source of truth
  src/index.ts            typed mirror (scale consts + semantic name union)
  src/tokens.test.ts      parity + contrast, both computed from tokens.css
packages/ui/
  package.json            + devDependencies for component tests (approved packages)
  src/cn.ts               cn()
  src/button.tsx  input.tsx  textarea.tsx  sidebar-item.tsx
  src/menu.tsx  dialog.tsx  message-card.tsx  adham-icon.tsx
  src/*.test.tsx          one per component
  src/index.ts            barrel
scripts/
  check-magic-values.mjs  grep gate, wired into `pnpm check`
apps/desktop/
  public/no-flash-theme.js  classic, non-deferred, allowed by script-src 'self'
  index.html                + external script reference, no inline script
  src/theme/theme-provider.tsx  src/theme/use-theme.ts
  src/routes/index.tsx  src/routes/__root.tsx  src/styles/index.css
docs/
  Design system — tokens & components.md   new, source of truth
```

---

## Shared component pattern

Tasks 4–10 are component tasks and follow one shape. Only the specifics differ; each task lists them.

- **Step 1 — failing test:** write `src/<name>.test.tsx` covering exactly the task's state list from the spec §7 matrix, plus the two shared assertions below.
- **Step 2 — verify FAIL.**
- **Step 3 — implement** `src/<name>.tsx` with a CVA `variants` object, React 19 signature (no `forwardRef`; `ref` is a plain prop).
- **Step 4 — verify PASS.**
- **Step 5 — export from `src/index.ts`, run `pnpm check`, commit.**

Shared assertions every component test carries:
- renders without a direction-locked utility (`/left-|right-|(^|\s)ml-|(^|\s)mr-|(^|\s)pr-/` has no match in `className`)
- `className` from the caller survives (`tailwind-merge` dedupe)

---

### Task 1: Three-tier tokens + typed mirror + parity and contrast tests

**Files:**
- Modify: `packages/design-tokens/tokens.css`
- Modify: `packages/design-tokens/src/index.ts`
- Create: `packages/design-tokens/src/tokens.test.ts`

**Interfaces:**
- Produces: tier-2 runtime var names (`--background`, `--surface`, `--surface-raised`, `--surface-subtle`, `--surface-muted`, `--surface-hover`, `--foreground`, `--foreground-secondary`, `--foreground-muted`, `--foreground-disabled`, `--surface-disabled`, `--border-subtle`, `--border`, `--border-strong`, `--border-interactive`, `--brand`, `--action`, `--action-hover`, `--action-pressed`, `--action-foreground`, `--accent`, `--accent-hover`, `--selection`, `--focus`, `--scrim`, `--shadow-floating`, `--success`, `--success-surface`, `--success-foreground`, `--warning`, `--warning-surface`, `--warning-foreground`, `--danger`, `--danger-hover`, `--danger-surface`, `--danger-foreground`, `--info`, `--info-surface`, `--info-foreground`, `--running`, `--running-surface`, `--running-foreground`); tier-1 scale consts; the `ThemeVar` string union exported as `SEMANTIC_VARS`.
- Consumed by: every later task (utility names come from tier 3).

- [ ] **Step 1: Write the failing parity test**

```ts
// packages/design-tokens/src/tokens.test.ts
import { readFileSync } from 'node:fs';
import { SEMANTIC_VARS, SCALES } from './index';

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const declared = new Set([...css.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]));

it('exports every semantic name declared in tokens.css', () => {
  for (const name of SEMANTIC_VARS) expect(declared.has(name)).toBe(true);
});
it('declares no semantic runtime var missing from the mirror', () => {
  const runtime = [...declared].filter((n) => !n.startsWith('color-') && !n.startsWith('space-'));
  for (const n of runtime) expect(SEMANTIC_VARS).toContain(n);
});
it('scale values match the spec', () => {
  expect(SCALES.radius.md).toBe('6px');
  expect(SCALES.control).toEqual({ sm: '32px', md: '36px', lg: '40px' });
  expect(SCALES.space).toEqual(['4px','8px','12px','16px','20px','24px','32px','40px','48px','64px']);
});
```

- [ ] **Step 2: Verify FAIL**

Run: `pnpm test packages/design-tokens`
Expected: FAIL — `SEMANTIC_VARS` is not exported.

- [ ] **Step 3: Rewrite `tokens.css` to three tiers**

Tier 1 in `@theme { --color-*: initial; … }`: `--space-1…16`, `--radius-{none,xs,sm,md,lg,xl,2xl,full}` = `0/2/4/6/8/12/16/9999px`, `--control-{sm,md,lg}` = `32/36/40px`, `--font-size-body 14px` + `--line-height-body 20px` + `--font-size-read 16px` + `--line-height-read 24px`, `--icon-{sm,md,lg}` = `16/20/24px`, `--duration-{fast,base,slow}` = `120/180/260ms`, `--ease-standard cubic-bezier(0.2,0,0,1)`, `--ease-exit cubic-bezier(0.4,0,1,1)`, `--z-{dialog,menu,popover,toast}` = `400/500/500/700`.

Then `@custom-variant dark (&:where(.dark, .dark *));`, then `:root { color-scheme: light; …tier-2… }`, `.dark { color-scheme: dark; …tier-2… }`, then `@theme inline { --color-<name>: var(--<name>); }` for every tier-2 name so a `bg-<name>` utility exists.

Also in this step, all three base-layer rules the spec §6 requires:
- `::selection { background: var(--selection); }`
- `@media (prefers-reduced-motion: reduce)` → `--duration-fast/base/slow: 0ms`
- `@media (forced-colors: active)` → focus and selected states fall back to `Canvas`, `CanvasText`, `LinkText` and `Highlight` system colours

- [ ] **Step 4: Write `src/index.ts`**

Export `SCALES` (the exact objects asserted in Step 1), `SEMANTIC_VARS` as `readonly ThemeVar[]`, and `type ThemeVar`.

- [ ] **Step 5: Add the contrast test**

Parse `tokens.css` (split on `:root` / `.dark` blocks), compute WCAG relative luminance from the hex values directly — **not** `axe-core`, which needs computed styles jsdom cannot produce for CSS variables. Assert, over the full pairing matrix:

- every `--foreground*` × `{background, surface, surface-raised, surface-subtle, surface-muted, surface-hover}` ≥ **4.5**
- every control `--border` and `--border-strong` × `{surface, background}` ≥ **3.0**
- each status `-foreground` × its own `-surface` ≥ **4.5**
- `--accent` × `{background, surface}` ≥ **4.5**
- `--border-subtle` is **exempt** (decorative dividers only)

- [ ] **Step 6: Verify PASS**

Run: `pnpm test packages/design-tokens`
Expected: PASS. If a candidate value fails, correct it in `tokens.css` and re-run — the test is the authority.

- [ ] **Step 7: Commit**

```bash
git add packages/design-tokens
git commit -m "feat(design-tokens): three-tier semantic tokens with parity and contrast tests"
```

---

### Task 2: Magic-value enforcement gate

**Files:**
- Create: `scripts/check-magic-values.mjs`
- Modify: `package.json` (add script, extend `check`)

**Interfaces:**
- Produces: exit code 1 with offending `file:line` on violation; exit 0 when clean.

- [ ] **Step 1: Write the failing gate**

Script scans `packages/ui/src` and `apps/desktop/src` for: hex literals `#[0-9a-fA-F]{3,8}`, arbitrary values `bg-[var(` / `text-[var(` / `border-[var(`, bare z utilities `z-[0-9]+` and `z-(xs|sm|md|lg|xl)`, and cleared Tailwind default palette names (`-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2}`).

- [ ] **Step 2: Verify FAIL on a seeded violation**

Run: `node scripts/check-magic-values.mjs`
Expected: fails while `routes/index.tsx` still holds `var(--color-…,#hex)` values.

- [ ] **Step 3: Wire into `check`**

`"check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && node scripts/check-magic-values.mjs"`.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-magic-values.mjs package.json
git commit -m "build: gate magic values in packages/ui and apps/desktop"
```

---

### Task 3: Test dependency placement + `cn()`

**Files:**
- Modify: `packages/ui/package.json` (devDependencies)
- Create: `packages/ui/src/cn.ts`, `packages/ui/src/cn.test.ts`

**Interfaces:**
- Produces: `export function cn(...inputs: ClassValue[]): string`
- Consumes: approved packages `clsx`, `tailwind-merge`.

Note: these are already-approved packages from `dependency-proposal.md` §2.2 — this is workspace placement, not a new dependency decision.

- [ ] **Step 1: Failing test for `cn` override**

```ts
it('lets a caller className override the base', () => {
  expect(cn('p-4', 'p-8')).toBe('p-8');
});
it('joins conditional classes', () => {
  expect(cn('a', false && 'b', 'c')).toBe('a c');
});
```

- [ ] **Step 2: Verify FAIL**

Run: `pnpm test packages/ui/src/cn.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement `cn`**

`clsx` for joining, `tailwind-merge`'s `twMerge` for dedupe.

- [ ] **Step 4: Verify PASS**

Run: `pnpm test packages/ui/src/cn.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm pre-existing button test status and report**

Run: `pnpm test packages/ui/src/button.test.tsx`
Record whether it passed *before* any of this plan's changes. If it failed, report it — do not attribute the failure to this plan.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json packages/ui/src/cn.ts packages/ui/src/cn.test.ts
git commit -m "feat(ui): cn() helper and test dependency placement"
```

---

### Task 4: Button

**Files:**
- Modify: `packages/ui/src/button.tsx`, `packages/ui/src/button.test.tsx`
- Test: `packages/ui/src/button.test.tsx`

**Interfaces:**
- Produces: `variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'`; `size?: 'sm' | 'md' | 'lg'`; `loading?: boolean`; `ref?: React.Ref<HTMLButtonElement>`.
- State list (spec §7): default, hover, pressed, focus-visible, disabled, loading.

- [ ] **Step 1: Rewrite the test** — cover all six states; keep and update the two approved assertions to semantic tokens (`bg-action`, `bg-surface-subtle`). Add `loading` → `aria-busy="true"`, `disabled` → `disabled` attribute, `min-h-control-{sm,md,lg}` per size, `rounded-md` on every size.
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement with CVA**, React 19 signature (`ref` as plain prop), base `cn()`-composed classes using semantic utilities only.
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: `pnpm check`, then commit.**

---

### Task 5: Input + Textarea

**Files:**
- Create: `packages/ui/src/input.tsx`, `packages/ui/src/textarea.tsx`, `packages/ui/src/input.test.tsx`, `packages/ui/src/textarea.test.tsx`

**Interfaces:**
- Produces: `InputProps` / `TextareaProps` with `invalid?: boolean`, `errorMessage?: string`, `size?: 'sm'|'md'|'lg'`, `ref`.
- State list: default, hover, focus-visible, disabled, invalid, read-only.

- [ ] **Step 1: Failing tests** — `invalid` sets `aria-invalid="true"` and wires `aria-describedby` to the error node which carries `role="alert"`; `read-only` maps to the `readOnly` attribute; label association via `htmlFor`/`id`.
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** both with `min-h-control-*`, `--border` for the control boundary, `--border-strong` on focus.
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: `pnpm check`, commit.**

---

### Task 6: SidebarItem

**Files:**
- Create: `packages/ui/src/sidebar-item.tsx`, `packages/ui/src/sidebar-item.test.tsx`

**Interfaces:**
- Produces: `selected?: boolean`, `disabled?: boolean`, `href?: string` (renders `<a>`, else `<button>`).
- State list: default, hover, pressed, selected, focus-visible, disabled.

- [ ] **Step 1: Failing tests** — `selected` → `aria-current="page"` and `bg-selection`; `href` renders an anchor.
- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implement** the component with a CVA `variants` object, React 19 signature (`ref` as a plain prop, no `forwardRef`), composed through `cn()` using semantic utilities only.

- [ ] **Step 4: Verify PASS.**

- [ ] **Step 5: Export from `src/index.ts`, run `pnpm check`, commit.**

---

### Task 7: Menu

**Files:**
- Create: `packages/ui/src/menu.tsx`, `packages/ui/src/menu.test.tsx`

**Interfaces:**
- Produces: `Menu`, `MenuItem`, `MenuSeparator`, `MenuGroup`. Positioning is plain CSS (`position: absolute` in a `position: relative` anchor) — **no `@floating-ui/react`**.
- State list (items): default, hover, pressed, selected, focus-visible, disabled.

- [ ] **Step 1: Failing tests** — roving tabindex (exactly one item with `tabindex="0"`); `ArrowDown`/`ArrowUp` move focus and wrap; `Escape` closes and returns focus to the trigger; `role="menu"` / `role="menuitem"`; `disabled` items are skipped by arrow navigation.
- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implement** the component with a CVA `variants` object, React 19 signature (`ref` as a plain prop, no `forwardRef`), composed through `cn()` using semantic utilities only.

- [ ] **Step 4: Verify PASS.**

- [ ] **Step 5: Export from `src/index.ts`, run `pnpm check`, commit.**

---

### Task 8: Dialog

**Files:**
- Create: `packages/ui/src/dialog.tsx`, `packages/ui/src/dialog.test.tsx`

**Interfaces:**
- Produces: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogClose`. Uses `--scrim` and `--z-dialog 400`.
- State list: default, focus-visible. (No hover/pressed/disabled/loading/invalid/read-only on the container.)

- [ ] **Step 1: Failing tests** — `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; focus moves into the dialog on open and returns to the trigger on close; `Escape` closes; tab is trapped inside while open; scrim uses `var(--scrim)`.
- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implement** the component with a CVA `variants` object, React 19 signature (`ref` as a plain prop, no `forwardRef`), composed through `cn()` using semantic utilities only.

- [ ] **Step 4: Verify PASS.**

- [ ] **Step 5: Export from `src/index.ts`, run `pnpm check`, commit.**

---

### Task 9: MessageCard

**Files:**
- Create: `packages/ui/src/message-card.tsx`, `packages/ui/src/message-card.test.tsx`

**Interfaces:**
- Produces: `role: 'user' | 'assistant' | 'system'`, `text: string`, `timestamp: string`, `selected?: boolean`, `editable?: boolean`.
- State list: default, hover, pressed, selected, focus-visible, read-only.

- [ ] **Step 1: Failing tests** — renders `<article>`; role label is **text**, not colour alone; `selected` → `bg-selection`; `readOnly` honoured when `editable` is false.
- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implement** the component with a CVA `variants` object, React 19 signature (`ref` as a plain prop, no `forwardRef`), composed through `cn()` using semantic utilities only.

- [ ] **Step 4: Verify PASS.**

- [ ] **Step 5: Export from `src/index.ts`, run `pnpm check`, commit.**

---

### Task 10: AdhamIcon

**Files:**
- Create: `packages/ui/src/adham-icon.tsx`, `packages/ui/src/adham-icon.test.tsx`

**Interfaces:**
- Produces: `size?: 'sm' | 'md' | 'lg'` → 16/20/24px, `label?: string`, `mirrored?: boolean`. Children are `<path>` elements.

- [ ] **Step 1: Failing tests** — no `label` → `aria-hidden="true"`; with `label` → `role="img"` + `aria-label`; size maps to `--icon-*`; `mirrored` applies an RTL-aware horizontal flip; `currentColor` stroke.
- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implement** the component with a CVA `variants` object, React 19 signature (`ref` as a plain prop, no `forwardRef`), composed through `cn()` using semantic utilities only.

- [ ] **Step 4: Verify PASS.**

- [ ] **Step 5: Export from `src/index.ts`, run `pnpm check`, commit.**

---

### Task 11: Theme switching + no-flash script

**Files:**
- Create: `apps/desktop/src/theme/theme-provider.tsx`, `apps/desktop/src/theme/use-theme.ts`, `apps/desktop/public/no-flash-theme.js`
- Modify: `apps/desktop/index.html`, `apps/desktop/src/main.tsx`, `apps/desktop/src/routes/__root.tsx`

**Interfaces:**
- Produces: `type Appearance = 'system' | 'light' | 'dark'`; `type Palette = 'neutral' | 'zinc' | 'slate'`; `useTheme(): { appearance, setAppearance, resolvedAppearance, palette, setPalette }`.

- [ ] **Step 1: Failing tests** — `system` resolves via `matchMedia` and tracks changes; `setAppearance` persists to `localStorage` and adds/removes `.dark` on `<html>`; only `'neutral'` is accepted for `palette` in v1.
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement provider + hook.**
- [ ] **Step 4: Add the external no-flash script** — `apps/desktop/public/no-flash-theme.js`, read `localStorage` + `matchMedia`, set `document.documentElement.className` **before first paint**. Reference from `<head>` as `<script src="/no-flash-theme.js"></script>` — classic, no `type="module"`, no `defer`, **no inline script**.
- [ ] **Step 5: Verify PASS** + Review Focus #4:
  Run: `pnpm test apps/desktop` and assert `index.html` contains zero inline `<script>` blocks (only `src=` references). Confirms `script-src 'self'` is not violated.
- [ ] **Step 6: `pnpm check`, commit.**

---

### Task 12: Route migration

**Files:**
- Modify: `apps/desktop/src/routes/index.tsx`, `apps/desktop/src/routes/__root.tsx`, `apps/desktop/src/styles/index.css`

- [ ] **Step 1: Failing test** — render `index.tsx` under `dir="rtl"` and assert the class string contains no direction-locked utility (`/left-|right-|(^|\s)ml-|(^|\s)mr-|(^|\s)pr-/`); assert no `var(--` and no `#hex` remain in either file.
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Migrate** — all ~20 `var(--color-x, #hex)` → semantic utilities; `rounded-xl/2xl` → `rounded-lg/xl`; `shadow-xs` → token; `pr-24`/`right-3` → `pe-`/`end-`; textarea → `Input`-equivalent; message block → `MessageCard`.
- [ ] **Step 4: Verify PASS.** Report, do not fix, the hardcoded English string at `index.tsx:82`.
- [ ] **Step 5: `pnpm check`, commit.**

---

### Task 13: Browser verification

**Files:**
- Create: `docs/reports/design-system-verification.md`

Run against `pnpm dev` with Playwright. Synthetic canary content only.

- [ ] **Step 1: Forced colours** — emulate `forced-colors: active`; assert focus and selected states resolve to a non-`transparent` outline/background (Review Focus #3).
- [ ] **Step 2: 200% text scaling** — set root font-size to 200%; for Button, Input, SidebarItem assert `scrollHeight <= clientHeight + 1`, i.e. no clipping (Review Focus #2).
- [ ] **Step 3: Visual sweep** — capture button, input, sidebar item, menu, dialog and conversation message in **light and dark**; record results.
- [ ] **Step 4: Write the report and commit.**

```bash
git add docs/reports/design-system-verification.md
git commit -m "docs: design system browser verification report"
```

---

### Task 14: Documentation

**Files:**
- Create: `docs/Design system — tokens & components.md`
- Modify: `docs/Engineering — Initial repository architecture-and-setup instructions.md` §6/§9
- Modify: `docs/spec/p0/inital wiring.md` §28
- Modify: `docs/spec/p0/P0-06 — Repository scaffold execution and evidence checklist.md` line 190

- [ ] **Step 1: Create `docs/Design system — tokens & components.md`** — the source of truth: all three tiers with values, the state matrix, component contracts, Do/Don't tables, and the approved dependency list. Under 300 lines.
- [ ] **Step 2: Surgical edits only.** The Engineering doc is **709 lines** — already past the 600-line exception threshold. Add the three-tier contract and consumer rule without growing it materially; if it must grow, record the exception.
- [ ] **Step 3: Update `inital wiring.md` §28** to record the seeded state, and **P0-06 line 190** with evidence that Tailwind is configured with a token set reserving `#2B2BFF` primarily for actions.
- [ ] **Step 4: `pnpm check`, commit.**

```bash
git add docs
git commit -m "docs: design token system reference and gate evidence"
```
