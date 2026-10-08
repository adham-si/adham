# Component Gallery Verification Report

**Date:** 2026-10-07  
**Status:** Verified & Complete  
**Branch:** `feat/component-gallery`  
**Plan:** `docs/spec/p0/P0-06 — Repository scaffold execution and evidence checklist.md`  
**Specs:** `docs/Engineering — Initial repository architecture-and-setup instructions.md`; design-system gap source: `docs/reports/design-system-verification.md`

---

## 1. Implemented Gallery Structure

| Item | Path | Responsibility |
|---|---|---|
| Gallery route | `apps/desktop/src/routes/gallery.tsx` | `createFileRoute('/gallery')`, `<main>` landmark, renders all sections in one scrollable surface; feature i18n registration |
| Section scaffold | `apps/desktop/src/widgets/gallery/gallery-section.tsx` | `GallerySection` / `GalleryRow` wrappers + shared `galleryTriggerClasses` |
| `ButtonSection` | `apps/desktop/src/widgets/gallery/button-section.tsx` | 5 variants × sm/md/lg, disabled, loading, full-width, icon-only row (sizes + variants + iconOnly-loading) |
| `FormsSection` | `apps/desktop/src/widgets/gallery/forms-section.tsx` | textarea + input × sm/md/lg, invalid w/ live alert, disabled, read-only |
| `NavigationSection` | `apps/desktop/src/widgets/gallery/navigation-section.tsx` | sidebar-style items, active, disabled, link |
| `OverlaysSection` | `apps/desktop/src/widgets/gallery/overlays-section.tsx` | `@adham/ui` `DropdownMenu` + `Dialog` renderings |
| `MessageCardSection` | `apps/desktop/src/widgets/gallery/message-card-section.tsx` | user / assistant / system cards, selected + editable states |
| `IconSection` | `apps/desktop/src/widgets/gallery/icon-section.tsx` | sm/md/lg set, labelled icon, RTL-mirrored example |
| Feature i18n | `apps/desktop/src/widgets/gallery/i18n.ts` | en / ar / zh-CN / ru resources registered via `i18n.addResourceBundle` (keeps `shared/i18n` under the size limit) |
| Barrier | `apps/desktop/src/widgets/gallery/index.ts` | barrel export |

All strings are i18n resources owned by the widget; the shared bundle (`apps/desktop/src/shared/i18n/index.ts`) is unchanged by this work. The route is intentionally **not** linked from the navigation rail.

## 2. Quality Gate Verification

### A. Magic Values & Design Token Compliance
```bash
> pnpm check:magic-values
Magic-value check passed: no hex literals, arbitrary var() values, bare z-index utilities, or cleared Tailwind defaults.
```
0 hex colors; all styling uses `@adham/design-tokens` semantic tokens. No direction-locked utilities.

### B. Formatter & Lint (gallery scope)
```bash
> biome format apps/desktop/src/routes/gallery.tsx apps/desktop/src/widgets/gallery
Checked 11 files in 4ms. No fixes applied.

> oxlint apps/desktop/src/routes/gallery.tsx apps/desktop/src/widgets/gallery --deny-warnings
0 warnings, 0 errors.
```

### C. Typecheck & Full Test Suite
```bash
> tsc --noEmit
Passed with 0 errors.

> vitest run
Test Files  19 passed (19)
     Tests  277 passed (277)
```
Includes `apps/desktop/src/widgets/gallery/gallery.test.tsx` (4 tests): heading/section presence with disabled button; Dialog open + focus/`aria-modal` + Escape close; Menu open/items/disabled item + Escape close; axe scan with jsdom-only rules disabled (`color-contrast`, `document-title`, `html-has-lang`, `region`).

### D. File Size
Largest gallery file is `i18n.ts` at 281 lines (limit 600, review at 400). Repo-wide scan errors only on `apps/desktop/src/shared/i18n/index.ts` (pre-existing, 745 lines, owned by settings work).

## 3. Browser Verification (dev server, `http://localhost:11111/gallery`)

| Check | Result |
|---|---|
| Route renders all sections (Buttons, Inputs, Sidebar items, Menus & Dialogs, Message cards, Icons) | Pass |
| Console errors | 0 (1 non-blocking TanStack code-split warning for `GalleryPage` export) |
| Dialog: opens with `role=dialog`, heading + description, `aria-modal`, focus moves in | Pass |
| Dialog: Escape closes and removes node | Pass |
| Menu: opens with `menu`/`menuitem` roles, group label, disabled item honored | Pass |
| Menu: Escape closes | Pass |
| Dark scheme: `prefers-color-scheme` → surfaces render on `bg-surface` (rgb(14,14,17)) | Pass |
| RTL / mirror examples present (labelled + mirrored icon rows) | Pass |
| Screenshot (dark, full-page) | `docs/reports/evidence/gallery-dark.png` |

## 4. Defect Found & Fixed — invisible Danger button label

**Symptom:** gallery rendered Danger buttons as empty salmon blocks (both themes).

**Root cause:** `packages/ui/src/button.tsx` paired `bg-danger` with `text-danger-foreground`, but the token spec defines `--danger-foreground` as *status text on `--danger-surface`* — and its value equals `--danger` in both themes (light `#b91c1c`/`#b91c1c`, dark `#f87171`/`#f87171`) → text-on-background contrast exactly **1.00:1**. The token values were spec-correct; the button pairing was not. No gate caught it because `tokens.test.ts` only checks spec-sanctioned pairings and jsdom never computes contrast.

**Fix (zero token changes — both pairs are in the spec's verified matrix):**
`danger: 'bg-danger text-danger-surface hover:bg-danger-hover active:bg-danger-hover'`
plus a regression assertion in `button.test.tsx` (danger renders `text-danger-surface`, never `text-danger-foreground`).

**Verified contrast (computed in-browser from `getComputedStyle`):**

| Theme | Background | Text | Ratio |
|---|---|---|---|
| Dark | `#f87171` | `#450a0a` | **5.84:1** ✓ |
| Light | `#b91c1c` | `#fee2e2` | **5.30:1** ✓ |

Gates after fix: `tsc` 0 errors, **229/229 tests** (+1 regression), oxlint/biome/magic-values clean on touched files. Evidence: `evidence/gallery-danger-dark-buttons.png`, `evidence/gallery-danger-light.png`, regenerated `evidence/gallery-dark.png`.

## 5. Button additions — icon-only, visible loading spinner, softened secondary border

- **`iconOnly` prop:** square control (`aspect-square px-0`) sized by the existing scale; `px-0` is ordered after `size` in the CVA map so tailwind-merge lets it win. Accessible name comes from `aria-label` (tested).
- **Visible loading:** internal `BusySpinner` svg — `stroke="currentColor"` (inherits the variant's text token, no colour of its own), `animate-spin motion-reduce:animate-none`, `size-icon-*` matched to button size. Spinner replaces children when `iconOnly`, precedes them otherwise (label stays → no width jump). Busy stays full opacity via `disabled:not-aria-busy:opacity-60`.
- **Secondary border:** rests on `border-border-subtle`, restores `border` on `focus-visible` only — hover-border sharpening was removed afterwards (§8); buttons signal hover through background colour.

Verified in-browser (computed styles): icon-only 32×32 `aspect-ratio 1/1` `padding 0`; loading opacity **1** vs disabled **0.6**; spinner `animation-name: spin` → **none** under emulated `prefers-reduced-motion`; secondary border `#272733` at rest (hover-sharpening to `#6a6a80` verified at the time, removed afterwards — §8). Gates: 233/233 tests (+4), tsc 0, oxlint/biome/magic-values clean on all touched files. Evidence: `evidence/gallery-buttons-icon-loading-dark.png`.

## 6. Input/Textarea audit — sizes, radius, borders, text, RTL

Five checks in the requested order, measured in-browser (dev, both themes) against
`packages/ui/src/field.ts` (shared by Input and Textarea):

| # | Check | Result |
|---|---|---|
| 1 | Control sizes | **Pass** — 32/36/40 px measured, pads 12/16/16, fonts 12/14/16, `min-h` (no fixed `h-*`), test-locked |
| 2 | Radius | **Pass** — 6px `--radius-md` all sizes; controls 6 / surfaces 8 / menu rows 4 — coherent |
| 3 | Borders | **Defect** — rest was `--border` (same loud outline as pre-fix secondary button) and **hover was dead** despite the contract's hover ✓; fixed (below) |
| 4 | Text / zod | **Pass** — zod is transport-only (`messageKey` + `fieldErrors` → localized; no raw zod copy can reach a field); gallery copy coherent in 4 locales |
| 5 | RTL/LTR | **Pass** — zero direction-locked utilities (×8 `DIRECTION_LOCKED` tests); live `dir=rtl` flips cleanly, no overflow. **Doc defect fixed:** `inital wiring.md` claimed enforcement lives in `check-magic-values.mjs` — corrected to the per-component tests |

**Fix (decisions: quiet rest like the button, 1px borders only, branded focus):**

- `field.ts`: rest `border-border-subtle`, sharpening to `border` on hover at the time (hover-border removed afterwards — §8); focus =
  `outline-2 -outline-offset-1 outline-focus` (the 1px border reads as a 2px branded
  ring — `#7b7bff` dark / `#2b2bff` light, 5.25 / 7.26:1); invalid keeps
  `border-danger` (1px) + danger ring so errors never lose their colour. All widths 1px.
- **Purged** the repo's only non-1px border (`context-panel.tsx` tab underline
  `border-b-2` → `border-b`) and **forbade** the class: new `border-width` rule in
  `check-magic-values.rules.json` (self-test 25/25).
- Docs: border-discipline exception extended to fields in
  `docs/Design system — tokens & components.md` and the spec
  (`2026-10-07-design-token-system-design.md`); contract row, Do/Don't row, and
  Enforcement section updated.
- Tests: 235/235 (+2: hover/quiet-rest, branded-ring/1px-width per component),
  tsc 0, oxlint/biome clean, magic-values + self-test pass, file-size errors only on
  the pre-existing settings-owned `shared/i18n/index.ts` (745).
- Evidence: `evidence/gallery-inputs-dark.png`, `gallery-inputs-dark-hover.png`
  (re-taken post-§8: border stays quiet under real `:hover`),
  `gallery-inputs-dark-focus.png`, `gallery-inputs-light.png`.

## 8. Hover border removed (follow-up)

Hover must never touch a control border — buttons signal hover through background
colour (`hover:bg-*`); inputs/textareas stay quiet until focused/clicked:

- `button.tsx` secondary: dropped `hover:border-border` (kept
  `focus-visible:border-border` + `hover:bg-surface-muted`).
- `field.ts`: dropped `hover:border-border` from the default branch.
- `field.ts`: dropped `transition-colors` — click/focus feedback snaps instantly,
  nothing fades (locked by `not.toContain('transition-')` in both field tests).
- Tests: same count, assertions flipped to `not.toContain('hover:border')` for
  Button secondary, Input and Textarea.
- Docs: border-discipline wording in the design doc + spec now says hover leaves
  control borders alone.
- Gates: 235/235 tests, tsc 0, oxlint/biome/magic-values + self-test clean (re-run);
  browser: real `:hover` on an input keeps `#272733` (dark) — verified below.

## 9. Select component (custom dropdown)

Decision: custom dropdown (native `<select>` cannot toggle Down/Up arrows and its
popup is OS-styled). `packages/ui/src/select.tsx` (+21 tests) reuses the field
contract and Menu's proven patterns, without touching Menu:

- Props: `options`, `value`/`defaultValue`/`onValueChange`, `placeholder`,
  `indicator`/`indicatorOpen` slots, `sm/md/lg`, `invalid`/`errorMessage`.
  No icon dependency in `ui` — the app passes
  `<HugeiconsIcon icon={ArrowDown01Icon} />` / `<HugeiconsIcon icon={ArrowUp01Icon} />`
  (both verified exported from the installed package before use).
- Trigger: `fieldVariants` (1px quiet rest, no hover border, 2px branded focus
  ring, instant) + `flex justify-between`, truncated label, logical `end` indicator
  sized `[&_svg]:size-icon-*` per size.
- Listbox: `absolute start-0 end-0 top-full z-menu`, raised surface, `max-h-64`;
  roving focus, arrows/`Home`/`End`/`Enter`/`Escape`, focus return, outside-click
  close. Two implementation findings: closing synchronously on Tab unmounts the
  focused option before tab order resolves → Tab closes deferred; blur-close was
  tried and removed (a disabled-option pointer would wrongly close the list).
- Gallery: `FormsSection` demos all three sizes + invalid + disabled with the
  Hugeicons arrows; i18n keys added in all four locales.
- Verified in-browser (dark + light): 5 triggers at 32/36/40 with 16px arrows;
  open popup (raised bg, `--border`, 8px radius), auto-focus first option,
  `aria-expanded` toggle; focus ring `#7b7bff`/`#2b2bff` 2px at `-1px`.
- The new `border-width` gate flagged teammate's switch (`border-2`
  transparent spacer); fixed to 1px with geometry preserved (`items-center`,
  `translate-x-4.5` = 18px travel, verified computed) per explicit approval.
- Gates: 261/261 tests (18 files, gallery axe included), tsc 0,
  oxlint/biome/magic-values + self-test clean.
- Evidence: `evidence/gallery-select-dark-open.png`.
- Docs: `Select` contract rows added (design doc + spec).

## 10. Select popup refinement + shadow wiring fix

The sm trigger exposed an oversized popup (options fixed `text-sm` under a 12px
trigger) with zero hover feedback — and measuring it exposed a systemic defect:
`shadow-shadow-floating` never rendered any shadow. Tailwind reads the doubled
prefix as a shadow *color* (`--tw-shadow-color`), and the aliased value is a
shadow definition, not a color — so Menu, Dialog and Select popups (and the
teammate's settings modal, which already used the correct single prefix) all
rendered flat.

- `tokens.css`: added `--shadow-floating` to the `@theme inline` namespace
  aliases (generates the real `shadow-floating` size utility, runtime
  theme-correct like the other aliases); removed the bogus
  `--color-shadow-floating` alias. `tokens.test.ts` mapping test now branches
  shadow names into `--shadow-*` (with a comment explaining the trap).
- `menu.tsx`, `dialog.tsx`, `select.tsx`: `shadow-shadow-floating` →
  `shadow-floating`. Menu/Dialog keep their `--border` popup boundary (out of
  scope); only Select's popup quiets to `border-border-subtle`.
- `select.tsx` options: text/padding track trigger size (`sm: text-xs/px-3/py-1`,
  `md: text-sm/px-3/py-2`, `lg: text-base/px-4/py-2` — all tokens) and signal
  hover through `hover:bg-surface-hover` (background colour, never border).
  Keyboard focus keeps the 2px branded ring as the strong indicator.
- Verified in-browser (dark): popup 1px `#272733`, real shadow
  `rgba(0,0,0,0.4/0.45)` now computed (was `none`); sm options 12px/16px with
  4px/12px padding. Radius (popup 8, options 4) and spacing (p-1, mt-1) were
  already token-correct — no change.
- Gates: 266/266 tests (18 files), tsc 0, oxlint/biome/magic-values +
  self-test clean.
- Environment note: mid-session the shared dev server hot-reloaded (concurrent
  edits) and hook state visibly crossed instances — a selection appeared with no
  attributable click, and consecutive probes contradicted each other. Fresh load
  is stable across 6s idle and all 26 Select unit flows are deterministic, so
  this is environmental, not a component defect; stateful browser verification
  above comes from the coherent pre-flap window.

## 11. Row spacing unified at 4px

Row lists used three different rhythms: popup rows touched (0px), nav lists
breathed (4px), and several stacks sat at 8px. Per decision, inter-row space is
`gap-1` (4px, `--space-1`) everywhere — horizontal icon↔text `gap-2` is a
different axis and untouched:

- Select listbox + Menu popup + MenuGroup: `flex flex-col gap-1` (the nav-list
  pattern); Select options add `shrink-0` so the scrollable list never
  compresses rows.
- `MenuSeparator` dropped its own `my-1` (the gap now owns the rhythm; separator
  zones stay symmetric).
- `MenuGroup` heading dropped `pb-1` (`pt-2` → `pt-1`): heading-to-first-row was
  stacking to 8px, measured 4px after.
- Shell: nav-rail top group `gap-2` → `gap-1` (other groups already `gap-1`);
  primary-sidebar header `gap-2` → `gap-1`; session nav `gap-0.5` (2px,
  below the token floor) → `gap-1`.
- Verified live: menu child gaps 4/4, heading-to-row 4 (was 8); select option
  gap 4. Separator zones read 4+4 by construction (symmetric, no overlap
  possible with gap layout) — left as is.
- Gates: 277/277 tests (19 files — includes the new shell component tests),
  tsc 0, oxlint/biome/magic-values clean.

## 7. Notes

- Gallery is unlinked and ships with the desktop app by default (decision in review); the road-map follow-up is linking it from the navigation rail in a later phase.
- `axe-core` is imported as `import * as axeCore` because its package types use `export =` under `verbatimModuleSyntax`.
- `routeTree.gen.ts` is regenerated by `vite build` (no `tsr` binary in this repo) and is committed as generated output; no hand edits.