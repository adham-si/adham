# Design system — tokens & components

Source of truth for Adham's design system. `packages/design-tokens/tokens.css` is the
single source of truth for tokens; this document explains it and records the component
contracts.

Spec: `docs/superpowers/specs/2026-10-07-design-token-system-design.md`
Plan: `docs/superpowers/plans/2026-10-07-design-token-system.md`

## Token architecture

Three tiers. The rule that matters: **tier 2 is the only tier `.dark` redefines.**

| Tier | Contents | Redefines in `.dark`? |
|---|---|---|
| 1 — primitive | spacing, radius, control, type, icon, motion, z-index, scales | never |
| 2 — semantic | purpose-named runtime vars (`--background`, `--action`, `--focus`…) | **yes, only this** |
| 3 — component | `@theme inline` mapping + CVA class maps in `packages/ui` | inherits tier 2 |

```css
@custom-variant dark (&:where(.dark, .dark *));

:root { color-scheme: light; --action: #2b2bff; }
.dark  { color-scheme: dark;  --action: #3d3dff; }

@theme inline { --color-action: var(--action); }  /* → .bg-action */
```

Runtime vars deliberately sit outside the `--color-*` namespace so `@theme inline` never
self-references. Resolution is plain inheritance, with no `:root`/`.dark` specificity contest.

### Dark mode is class-based, not media-based

`@media (prefers-color-scheme: dark)` cannot be overridden by a user setting. Adham is a
desktop app with a persisted appearance preference, so `.dark` on `<html>` is the only
option that lets a person override the OS.

### Tier-1 scales must be aliased into Tailwind namespaces

Tailwind only emits utilities from specific namespaces — `--spacing-*`, `--color-*`,
`--radius-*`, `--z-index-*`. A bare `--control-md` produces nothing.

This was verified with a real build, not assumed: `min-h-control-md`, `size-icon-md` and
`z-dialog` were all **absent** from the compiled CSS until tier-1 was aliased:

```css
@theme inline {
  --spacing-control-sm: var(--control-sm);   /* → min-h-control-sm */
  --spacing-icon-md: var(--icon-md);         /* → size-icon-md   */
  --z-index-dialog: var(--z-dialog);         /* → z-dialog       */
}
```

`tailwind-merge` is equally unaware of these scales. `packages/ui/src/cn.ts` extends it
with the Adham groups, or a caller's `size="lg"` would be silently dropped.

## Scales

| Scale | Values |
|---|---|
| Spacing | `--space-1…10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px |
| Radius | `none 0 / xs 2 / sm 4 / md 6 / lg 8 / xl 12 / 2xl 16 / full` |
| Controls | `--control-sm 32 / --control-md 36 / --control-lg 40` |
| Typography | body `14/20`, reading `16/24` |
| Icons | `16 / 20 / 24` via `AdhamIcon` |
| Motion | `120 / 180 / 260 ms`; `--ease-standard`, `--ease-exit`; reduced-motion → `0ms` |
| Layering | `--z-dialog 400 / --z-menu 500 / --z-popover 500 / --z-toast 700` |

Two Adham decisions, not international standards: `--radius-md` is **6px** (not 8px), and
`--control-md` is **36px** (not 40px).

**Controls use `min-h-control-*` + padding, never a fixed `h-*`.** A fixed height clips
wrapped text at 200% font scaling. The spec calls the height a baseline, not a reason to clip.

Menus and popovers sit **above** dialogs, so a menu opened inside a dialog is not occluded.

## Colour

Five roles that must not collapse into one blue: `--brand` (identity only), `--action`
(what a button does), `--accent` (link and accent **text**), `--selection`, `--focus`.

`--brand` is not an action colour. `#2B2BFF` is reserved primarily for actions.

### Contrast

Enforced by `packages/design-tokens/src/tokens.test.ts`, computed from `tokens.css` values
directly — not `axe-core`, which needs computed styles jsdom cannot produce for CSS
variables. Over the full pairing matrix, in **both** themes:

| Pairing | Minimum |
|---|---|
| every `--foreground*` × `{background, surface, surface-raised, surface-subtle, surface-muted, surface-hover}` | 4.5:1 |
| `--border` / `--border-strong` × `{surface, background}` | 3:1 |
| each status `-foreground` × its own `-surface` | 4.5:1 |
| `--accent` × `{background, surface}` | 4.5:1 |

`--border-subtle` is **exempt**: it draws separation between regions, never the sole
indicator of a control's extent. Any boundary identifying an interactive control uses
`--border` or stronger and must clear 3:1. Exception: a labelled button or field
(Input/Textarea) may rest at `--border-subtle` — its label, not the outline alone,
identifies the control. Buttons restore `--border` on `focus-visible` only;
fields stay quiet on hover — focus replaces the 1px border with a 2px `--focus`
ring (`outline-2`, `-outline-offset-1`). **Hover never touches a control border**:
buttons signal hover through background colour, not border colour.

Border widths are **1px everywhere** — the focus ring is the only 2px line, drawn as
an outline, never as `border-2`/`border-4` (forbidden by `check-magic-values`, rule
`border-width`).

`--foreground-disabled` and `--surface-disabled` are informational. WCAG 1.4.3 exempts
disabled controls, so they are not gated.

Status colours each ship `-surface` + `-foreground` and are **always rendered with text or
an icon, never colour alone**. `--running` (agent-executing) is deliberately not info-blue:
primary action, selection, information and running-agent status must be distinguishable.

## Base-layer guarantees

- `::selection { background: var(--selection) }`
- `prefers-reduced-motion: reduce` → all three durations become `0ms`
- `forced-colors: active` → focus and selected fall back to `Canvas`, `CanvasText`,
  `LinkText` and `Highlight`. Without this both states vanish in Windows High Contrast, and
  this is a Windows-first app.

## Component contracts

The nine states do not apply uniformly.

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
| `Button` | `primary · secondary · ghost · danger · link` × `sm/md/lg`, `iconOnly` | native `<button>`; `loading` → `aria-busy` + spinner (stopped under reduced motion); icon-only requires `aria-label`; `type` defaults to `button` |
| `Input`, `Textarea` | `sm/md/lg`, `invalid`, `readOnly`, `errorMessage`; 1px border: rest `--border-subtle` (hover leaves it untouched), focus = 2px `--focus` ring (invalid: danger ring); state changes are instant, no transition | `aria-invalid` + `aria-describedby` → `role="alert"` node |
| `Select` | `options`, `value`/`defaultValue`/`onValueChange`, `placeholder`, `indicator`/`indicatorOpen`, `sm/md/lg`, `invalid`, `errorMessage`; same 1px boundary contract as fields | trigger `aria-haspopup="listbox"` + `aria-expanded`; arrows/`Home`/`End`/`Enter`/`Escape`/`Tab`, focus return; error `role="alert"` |
| `SidebarItem` | `selected`, `disabled`, `href` | `aria-current="page"`; `<a>` or `<button>` |
| `Menu` | `MenuItem`, `MenuGroup`, `MenuSeparator` | roving tabindex, arrows, `Home`/`End`, `Escape`, focus return |
| `Dialog` | `sm/md/lg`, `label` | `role="dialog"`, `aria-modal`, focus trap, focus return |
| `MessageCard` | `role`, `timestamp`, `selected`, `editable` | `<article>`; role as **text**; `<time>` with `dateTime` |
| `AdhamIcon` | `sm/md/lg`, `label`, `mirrored` | `aria-hidden` when decorative, `role="img"` + `aria-label` when named |

Conventions: CVA variants + `cn()`, React 19 — **no `forwardRef`**, `ref` is a plain prop.
Semantic HTML first. No third-party visual system.

### Do / Don't

| Do | Don't |
|---|---|
| `bg-surface`, `text-foreground-muted` | `bg-[var(--surface)]`, `bg-[#fff]` |
| `min-h-control-md` + padding | `h-9` |
| `ps-3` / `pe-3` / `end-3` | `pl-3` / `pr-3` / `right-3` |
| `z-dialog`, `z-menu` | `z-50` |
| `outline-focus` | `shadow` for a focus ring |
| `border` (1px) + focus `outline-2 -outline-offset-1` | `border-2` / `border-4` |
| `text-start` | `text-left` |

## Enforcement

`scripts/check-magic-values.mjs`, wired into `pnpm check`. Scans `packages/ui/src` and
`apps/desktop/src` for hex literals, arbitrary `var()` values, bare `z-` utilities,
non-1px border widths, and Tailwind's cleared default palette (`--color-*: initial`
wipes it, so `bg-red-600` cannot sneak in).

It strips comments before scanning. Strings are still scanned, since a hex colour inside a
string is a real violation. A gate that fires on `// see PR #1234` is a gate people learn
to bypass.

`scripts/check-magic-values.self-test.mjs` asserts the rule set against 25 cases, including
negative ones, so a regex change cannot silently weaken the gate.

## Theme switching

`appearance: 'system' | 'light' | 'dark'` persisted to `localStorage`, resolved onto
`<html class="dark">`, tracking `matchMedia` changes live. `palette` is **neutral-only in
v1**; `setPalette` throws on anything else, because accepting a setting that does nothing
is worse than refusing it.

`apps/desktop/public/no-flash-theme.js` is an **external classic script** referenced from
`<head>`. Tauri ships `script-src 'self'` with no `'unsafe-inline'`, so an inline script
would be blocked; the CSP is not weakened to accommodate it.

It sets `className`, `dir` **and** `lang` together. Setting only the theme class still
leaves an LTR frame on an Arabic machine, because i18n assigns `dir` when the bundle runs —
after first paint. Same flash, one property over.

## Approved dependencies

Nothing beyond these. Full rationale in `docs/reports/dependency-proposal.md` §2.3.

| Package | Role | Exit strategy |
|---|---|---|
| `class-variance-authority` | typed variant composition | replace with plain object maps |
| `clsx` | conditional class joining | replace with a local helper |
| `tailwind-merge` | lets a caller's `className` override the base | drop `cn()` merging; caller classes then conflict |

Explicitly **not** added: no icon package, no `@floating-ui/react` (the Menu positions with
plain CSS), no `radix-ui`/`shadcn`. `AdhamIcon` is a wrapper contract only.

## Non-goals for v1

Zinc and Slate palettes; independent light/dark palette choice; a settings screen for
appearance (the setting is wired, its UI is not); an icon set; any backend, IPC or Rust
change.