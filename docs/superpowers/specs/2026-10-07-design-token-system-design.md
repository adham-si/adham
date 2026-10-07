# Design token system — three-tier tokens, semantic components, theme switching

Date: 2026-10-07
Status: Approved (design stage), revised after spec review
Path: Architectural → next step is `writing-plans`, gated on §2 precondition

Skills used (paths are in-repo):

| Skill | Path |
|---|---|
| `superpowers:brainstorming` | `C:\Users\IronMan\.cache\opencode\packages\superpowers@git+https_\github.com\obra\superpowers.git\node_modules\superpowers\skills\brainstorming\SKILL.md` |
| `design-system` | `.opencode/skills/design-system/SKILL.md` |
| `tailwind-design-system` | `.opencode/skills/tailwind-design-system/SKILL.md` (+ `references/details.md`, `references/advanced-patterns.md`) |
| `building-components` | `.opencode/skills/building-components/SKILL.md` (+ `references/design-tokens.mdx`, `references/principles.mdx`) |
| `receiving-code-review` | `C:\Users\IronMan\.cache\opencode\packages\superpowers@git+https_\github.com\obra\superpowers.git\node_modules\superpowers\skills\receiving-code-review\SKILL.md` |

## 1. Intent

Turn Adham's flat, fixed-value token collection into a semantic token system, per the design review of 2026-10-07. The discipline is borrowed from Vercel's design system; the identity is not.

Success criteria:

- No hex literal and no arbitrary-value class (`bg-[var(--x,#hex)]`) survives in `packages/ui` or `apps/desktop`.
- Light/dark switch by redefining one layer of variables, not by editing markup.
- Every component exposes the states that apply to it, defined per component (§6).
- Contrast is enforced by a computed test with an explicit pairing matrix (§9).
- Forced-colors and 200% text scaling are handled, not assumed.
- Adding Zinc or Slate later is a deliberate diff, not a refactor.

## 2. Precondition for `writing-plans` — SATISFIED 2026-10-07

AGENTS.md forbids implementation until the six decisions in `docs/spec/p0/P0 — Implementation decisions & execution order.md` §5 are human-confirmed. **Decision 6 is dependency approval**, which covers D3 below.

> `class-variance-authority`, `clsx`, and `tailwind-merge` were approved 2026-10-07 and are recorded in `docs/reports/dependency-proposal.md` §2.3. Approval of this spec and approval of the dependencies are separate acts; both now exist.

## 3. Locked decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Approach A** — CSS single source of truth, typed TS mirror on top | Smallest change that enforces "tokens, not magic values"; no UI codegen |
| D2 | **Class-based dark mode** — `.dark` on `<html>` | Desktop needs a persisted user setting; `prefers-color-scheme` cannot be overridden |
| D3 | **CVA + `clsx` + `tailwind-merge`** | Typed variants, safe `className` merging — *subject to §2* |
| D4 | **Full 6-component set** | Matches the review's representative validation list |
| D5 | **Neutral palette family only**, both modes | Zinc/Slate multiply validation combinations |
| D6 | **No third-party visual system** | Engineering doc §6: Adham owns tokens, variants, motion, density, RTL, a11y |

Supersedes `packages/design-tokens/src/index.ts` exporting a single `brandColor` const.

## 4. Token architecture

Pattern: indirection (`building-components/references/design-tokens.mdx`).

```css
@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --color-action: var(--action);   /* → .bg-action { background-color: var(--action) } */
}

:root { color-scheme: light; --action: #2B2BFF; }
.dark  { color-scheme: dark;  --action: #3D3DFF; }
```

Runtime vars are outside the `--color-*` namespace, so `@theme inline` never self-references; resolution is pure inheritance with no `:root`/`.dark` specificity contest. `color-scheme` is set so native scrollbars, form controls and caret follow the theme.

| Tier | Contents | Redefines in `.dark`? |
|---|---|---|
| 1 — primitive | spacing, radius, control, type, icon, motion, z-index, neutral ramp, brand hex | never |
| 2 — semantic | purpose-named runtime vars (`--background`, `--action`, `--focus`…) | **yes — the only tier** |
| 3 — component | `@theme inline` maps + `packages/ui` CVA class maps | inherits tier 2 |

Files:

```
packages/design-tokens/
  tokens.css          # all three tiers — single source of truth
  src/index.ts        # typed mirror: scale consts + semantic-name union
  src/tokens.test.ts  # parity + contrast, both computed from tokens.css
```

Consumer rule — in `packages/ui` and `apps/desktop` only:

- semantic utilities (`bg-surface`, `text-foreground-muted`, `rounded-md`, `min-h-control-md`, `z-dialog`)
- never `bg-[var(--…)]`, never a hex, never a bare `z-50`
- enforced by a **grep-based script** wired into `pnpm check`

Why grep and not a lint rule: the violations live inside template-literal `className` strings that an AST rule will not reliably see, and Biome's linter is disabled in this repo (`biome.json` → `"linter": { "enabled": false }`). Oxlint *does* have a stable ESLint-compatible plugin API (`jsPlugins` + `RuleTester` from `oxlint/plugins-dev`) — it remains available if the grep proves too coarse, but it is not the primary mechanism.

`@theme { --color-*: initial; }` clears Tailwind's default palette so a default color cannot slip through. **Build-time check:** a script asserts no generated utility references a cleared default. If a utility genuinely needs one, define the token — do not restore defaults.

## 5. Color system

Five roles that must not collapse into one blue:

| Runtime var | Light | Dark |
|---|---|---|
| `--brand` (identity only) | `#2B2BFF` | `#3D3DFF` |
| `--action` / `-hover` / `-pressed` | `#2B2BFF` / `#1E1EDD` / `#1515B8` | `#3D3DFF` / `#5757FF` / `#2B2BFF` |
| `--action-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--accent` (accent/link **text**) | `#2B2BFF` (6.96:1) | `#9A9AFF` (7.75:1) |
| `--selection` | `#EBEBFF` | `#1E1E52` |
| `--focus` | `#2B2BFF` | `#7B7BFF` |

`#3D3DFF` as accent *text* on dark canvas measures 3.04:1 and fails — hence `#9A9AFF`.

Neutral surfaces and text — all values below were recomputed (WCAG 2.1 relative luminance) and are **candidates the §9 test re-verifies**:

| Runtime var | Light | Dark | Worst ratio |
|---|---|---|---|
| `--background` | `#FAFAFA` | `#0E0E11` | — |
| `--surface` | `#FFFFFF` | `#16161C` | — |
| `--surface-raised` | `#FFFFFF` | `#1E1E26` | — |
| `--surface-subtle` | `#F4F4F6` | `#1E1E26` | — |
| `--surface-muted` | `#EAEAED` | `#272733` | — |
| `--surface-hover` | `#F4F4F6` | `#272733` | — |
| `--foreground` | `#121214` | `#F4F4F6` | 13.42 ✓ |
| `--foreground-secondary` | `#5C5C66` | `#A0A0B0` | 5.50 / 5.72 ✓ |
| `--foreground-muted` | `#65656F` | `#9494A6` | **4.80 / 4.95 ✓** |
| `--border-subtle` | `#E2E2E6` | `#272733` | 1.29 / 1.22 — **decorative dividers only** |
| `--border` (control boundary) | `#8A8A96` | `#6A6A80` | **3.41 / 3.42 vs surface ✓** |
| `--border-strong` | `#6A6A78` | `#8A8A9E` | 5.32 / 5.33 ✓ |
| `--border-interactive` | `#2B2BFF` | `#7B7BFF` | — |

**Border discipline:** any boundary that identifies an interactive control (input, select, button outline, checkbox) uses `--border` or stronger and must clear 3:1. `--border-subtle` is *exempt* because it only draws visual separation between regions — it must never be the sole indicator of a control's extent.

Disabled — WCAG 1.4.3 exempts disabled controls, so these are informational, not gated:

| Runtime var | Light | Dark |
|---|---|---|
| `--foreground-disabled` | `#A8A8B4` (2.14) | `#4A4A5C` (1.91) |
| `--surface-disabled` | `#F4F4F6` | `#1E1E26` |

Status colors — each ships `-surface` + `-foreground`, always rendered with text or an icon, never color alone. Foreground-on-own-surface verified ≥4.5:1:

| Token | Light fg / surface | Dark fg / surface |
|---|---|---|
| `--success` | `#15803D` / `#DCFCE7` (4.57) | `#4ADE80` / `#052E16` (8.55) |
| `--warning` | `#92400E` / `#FEF3C7` (6.37) | `#FBBF24` / `#451A03` (8.97) |
| `--danger` (+`-hover`) | `#B91C1C` / `#FEE2E2` (5.30) | `#F87171` / `#450A0A` (5.84) |
| `--info` | `#1D4ED8` / `#DBEAFE` (5.49) | `#60A5FA` / `#0B1E4B` (6.35) |
| `--running` | `#0F766E` / `#CCFBF1` (4.86) | `#2DD4BF` / `#042F2E` (7.77) |

`--running` (agent-executing) is deliberately not info-blue: primary action, selection, information and running-agent status must be distinguishable.

**Overlay:** `--scrim` = `rgb(18 18 20 / 0.50)` light, `rgb(0 0 0 / 0.60)` dark.
**Selection:** `::selection { background: var(--selection); }`.
**Shadows — border-first, shadow-light:** persistent surfaces use tone + spacing + border with no shadow; menu/popover/dialog use restrained `--shadow-floating` *and* a border; the focus ring is never a shadow; the OS window shadow is untouched.

## 6. Primitive scales

| Scale | Values |
|---|---|
| Spacing (base 4) | `--space-1…16` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64; exceptions only for 1px borders and optical nudges |
| Radius | `none 0 / xs 2 / sm 4 / md 6 / lg 8 / xl 12 / 2xl 16 / full` |
| Controls | `--control-sm 32 / --control-md 36 / --control-lg 40`, applied as **`min-h-control-*` + padding**, never a fixed height |
| Typography | body `14/20`, reading `16/24`; smaller for secondary metadata only |
| Icons | `16 / 20 / 24` via `AdhamIcon` |
| Motion | `--duration-fast 120ms`, `--duration-base 180ms`, `--duration-slow 260ms`; `--ease-standard cubic-bezier(0.2, 0, 0, 1)`, `--ease-exit cubic-bezier(0.4, 0, 1, 1)`; reduced-motion → `0ms` |
| Layering | `--z-dialog 400 / --z-menu 500 / --z-popover 500 / --z-toast 700` |

- `--radius-md: 6px` corrects the current `8px`. It is an Adham decision, not an international standard.
- `--control-md: 36px` corrects the current `h-10` (40px). 32/36/40 is described as **Adham's Geist-inspired scale**, not verified Vercel measurements.
- Layering puts menus and popovers **above** dialogs so a menu opened inside a dialog does not render behind it. Toasts sit above everything.
- Line heights stay provisional until Arabic, Simplified Chinese and Russian validate.
- Icon size ≠ hit target; WCAG minimum pointer target is 24×24 CSS px, 32–40px controls are the desktop baseline.

**RTL:** logical properties only — `ps-/pe-/ms-/me-/start-/end-/text-start/rounded-s-/rounded-e-`. No `left-`, `right-`, `pr-`, `ml-`, `mr-`. Code and technical identifiers keep LTR treatment.

**Forced colors:** `@media (forced-colors: active)` supplies `Canvas`, `CanvasText`, `LinkText` and `Highlight` system colours for focus and selected states — without it both states vanish in Windows High Contrast, and this is a Windows-first app.

**Text scaling:** controls are sized by `min-h` + padding so 200% text grows the control instead of clipping. Verified in the browser (§9), since jsdom does not do layout.

## 7. Component contracts (`packages/ui`)

The nine states do **not** apply uniformly. Matrix (✓ = required, — = n/a):

| State | Button | Input/Textarea | SidebarItem | Menu item | Dialog | MessageCard |
|---|---|---|---|---|---|---|
| default | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| hover | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| pressed | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| selected | — | — | ✓ | ✓ | — | ✓ |
| focus-visible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| disabled | ✓ | ✓ | ✓ | ✓ | — | — |
| loading | ✓ | ✓ | — | — | — | — |
| invalid | — | ✓ | — | — | — | — |
| read-only | — | ✓ | — | — | — | ✓ |

| Component | Variants / props | Accessibility |
|---|---|---|
| `Button` | `primary · secondary · ghost · danger · link` × `sm/md/lg` | native `<button>`; `loading` → `aria-busy` |
| `Input`, `Textarea` | `sm/md/lg`, `invalid`, `read-only` | `<label>`; `aria-invalid` + `aria-describedby` → error text |
| `SidebarItem` | `selected`, `disabled` | `aria-current`; `<a>` or `<button>` |
| `Menu` | item sets, separators | roving tabindex, arrow keys, `Esc`, focus return |
| `Dialog` | sizes | focus trap, `Esc`, `role="dialog"`, `aria-modal`, focus return |
| `MessageCard` | `role`, timestamp | `<article>`; no meaning by colour alone |

Conventions: CVA variants + `cn()`; React 19 — **no `forwardRef`**; semantic HTML first; no third-party visual system. `AdhamIcon` is a wrapper contract only — no icon package is added in this task.

Each component ships a `.test.tsx` covering exactly its matrix row, plus a doc entry in the `design-system` format (Description / Variants / Props / States / Accessibility / Do-Don't), documented as it is built.

## 8. Theme switching

`ThemeProvider` + `useTheme()` per `tailwind-design-system` Pattern 6:

- `appearance: 'system' | 'light' | 'dark'`, persisted to `localStorage`, resolved onto `<html>`
- `system` resolves via `matchMedia('(prefers-color-scheme: dark)')` and tracks changes
- `palette: 'neutral' | 'zinc' | 'slate'` stored separately; only `neutral` enabled in v1
- **No-flash script must be an external file** referenced from `index.html` and executed before first paint. The current CSP in `apps/desktop/src-tauri/tauri.conf.json` is `script-src 'self'` with no `'unsafe-inline'`, so an inline `<script>` would be blocked. Do not weaken the CSP to accommodate it.

Independent light/dark palette choice is out of scope for v1.

## 9. Scope of changes

**Code**

| Path | Change |
|---|---|
| `packages/design-tokens/tokens.css` | rewrite to three tiers |
| `packages/design-tokens/src/index.ts` | typed mirror replaces the `brandColor` export |
| `packages/design-tokens/src/tokens.test.ts` | **new** — parity + contrast, computed from `tokens.css` |
| `packages/ui/src/{button,input,textarea,sidebar-item,menu,dialog,message-card,adham-icon}.tsx` | 6 components + icon wrapper |
| `packages/ui/src/*.test.tsx` | state/behaviour tests against the §7 matrix |
| `packages/ui/src/cn.ts` | `cn()` helper |
| `apps/desktop/src/theme/*` | `ThemeProvider`, `useTheme` |
| `apps/desktop/index.html` | external no-flash script reference |
| `apps/desktop/src/routes/{index,__root}.tsx` | migrate to semantic utilities + components |
| `apps/desktop/src/styles/index.css` | wire theme imports |
| `scripts/check-magic-values.*` | **new** — grep gate, added to `pnpm check` |

**Documents**

1. `docs/Engineering — Initial repository architecture-and-setup instructions.md` §6/§9 — three-tier contract + consumer rule. **Surgical edit only**: at 709 lines this file already exceeds the 600-line exception threshold; do not grow it materially.
2. `docs/spec/p0/inital wiring.md` §28 — record the seeded state
3. `docs/spec/p0/P0-06 — …evidence checklist.md` line 190 — evidence for the token gate
4. `docs/Design system — tokens & components.md` — **new**, source of truth for tokens and component contracts
5. `docs/reports/dependency-proposal.md` — add the three packages (§2 precondition)

**Known hard-coded string:** `routes/index.tsx:82` renders English inline instead of an i18n key. Reported, not silently fixed — a teammate may be editing that file concurrently.

## 10. Verification

`pnpm check` = `format:check && lint && typecheck && test`, extended:

| Gate | Asserts | How |
|---|---|---|
| Parity | every semantic name in `tokens.css` ↔ TS mirror, both directions | vitest |
| **Contrast** | ≥4.5:1 body text, ≥3:1 large text and control boundaries, **both themes**, over the full pairing matrix below | vitest, computing WCAG luminance **directly from `tokens.css` values** — not `axe-core`, which needs computed styles jsdom cannot produce for CSS variables or Tailwind |
| State tests | exactly the §7 matrix row per component | vitest + Testing Library |
| Magic values | no `bg-[var(`, no hex literal, no bare `z-` utility in `packages/ui` or `apps/desktop` | grep script in `pnpm check` |
| Default-leak | no generated utility references a cleared `--color-*` default | build-time script |
| Forced colours | focus + selected survive `forced-colors: active` | browser check |
| Text scaling | no clipping at 200% text size | browser check (jsdom does not lay out) |
| Visual | button, input, sidebar item, menu, dialog, message in light and dark | Playwright |

**Pairing matrix** — each `--foreground*` × each of `{background, surface, surface-raised, surface-subtle, surface-muted, surface-hover}`; each `--border` × `{surface, background}`; each status `-foreground` × its own `-surface`; each `--accent` × `{background, surface}`.

## 11. Non-goals

- Zinc and Slate palettes, or independent light/dark palette choice
- An icon package or the full `AdhamIcon` icon set
- Settings-page UI for appearance (the setting is wired, its screen is not)
- Backend, IPC, contract or Rust changes
- Any path outside §9

## 12. Risks

| Risk | Mitigation |
|---|---|
| `--color-*: initial` removes a utility something needs | define the token; never restore Tailwind defaults |
| A candidate colour fails the contrast test | correct it in `tokens.css` — the test is the authority |
| Teammate edits `index.tsx` concurrently | migrate only after confirming no in-flight edit; touch only the two approved Button assertions |
| Three dependencies unapproved | §2 makes approval a precondition of `writing-plans` |
| Arabic/zh/ru line-height issues surface late | line heights marked provisional in §6 |
| No-flash script blocked by CSP | external file under `script-src 'self'`; CSP is not weakened |
| Grep gate too coarse for computed classNames | fall back to an oxlint `jsPlugins` rule, which is ESLint-compatible and testable |
