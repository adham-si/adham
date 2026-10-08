import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCALES, SEMANTIC_VARS } from './index';

const baseUrl = import.meta.url;
const css = readFileSync(new URL('../tokens.css', baseUrl), 'utf8');

/**
 * Tier 2 is defined structurally, not by prefix guessing: a semantic runtime var
 * is one declared in the theme block — the `:root` carrying `color-scheme: light`
 * or the `.dark` carrying `color-scheme: dark`. Tier-1 scales live in `@theme`,
 * and the `--spacing-*` / `--z-index-*` aliases in `@theme inline` are tier-1 too,
 * so a prefix list would misclassify them the moment the scales grow. Anchoring on
 * `color-scheme` also skips the `:root` blocks nested in the reduced-motion and
 * forced-colors media queries.
 */
function themeBlockVars(scheme: 'light' | 'dark'): Set<string> {
  const selector = scheme === 'light' ? ':root' : '\\.dark';
  const names = new Set<string>();
  for (const block of css.matchAll(new RegExp(`${selector}\\s*{([^{}]*)}`, 'g'))) {
    const body = block[1] ?? '';
    if (!body.includes(`color-scheme: ${scheme}`)) continue;
    for (const decl of body.matchAll(/--([a-z0-9-]+):/g)) {
      if (decl[1] !== undefined) names.add(decl[1]);
    }
  }
  return names;
}

const tier2 = new Set([...themeBlockVars('light'), ...themeBlockVars('dark')]);

/** Every `@theme inline` block concatenated — there is more than one. */
const inlineTheme = [...css.matchAll(/@theme inline\s*{([^}]*)}/g)]
  .map((block) => block[1] ?? '')
  .join('\n');

describe('parity between tokens.css and the typed mirror', () => {
  it('exports every semantic name declared in tokens.css', () => {
    for (const name of SEMANTIC_VARS) {
      expect(tier2.has(name), `--${name} missing from tokens.css`).toBe(true);
    }
  });

  it('declares no semantic runtime var missing from the mirror', () => {
    for (const name of tier2) {
      expect(SEMANTIC_VARS, `--${name} missing from SEMANTIC_VARS`).toContain(name);
    }
  });

  it('maps every tier-2 name to a Tailwind utility in @theme inline', () => {
    // Shadow values are not colors: `shadow-floating` maps into the `--shadow-*`
    // namespace (utility `shadow-floating`), everything else into `--color-*`.
    // A `--color-shadow-floating` alias would make Tailwind read
    // `shadow-shadow-floating` as a shadow *color* and render no shadow.
    for (const name of tier2) {
      const declaration = name.startsWith('shadow-')
        ? `--${name}: var(--${name})`
        : `--color-${name}: var(--${name})`;
      expect(inlineTheme, `${declaration} missing from @theme inline`).toContain(declaration);
    }
  });

  it('maps the non-color tier-1 scales into namespaces Tailwind generates utilities from', () => {
    // `--control-md` alone produces nothing. Tailwind only emits `min-h-*` and
    // `size-*` from `--spacing-*`, and `z-*` from `--z-index-*`, so the tier-1
    // values must be aliased into those namespaces or the utilities do not exist.
    const required = [
      '--spacing-control-sm: var(--control-sm)',
      '--spacing-control-md: var(--control-md)',
      '--spacing-control-lg: var(--control-lg)',
      '--spacing-icon-sm: var(--icon-sm)',
      '--spacing-icon-md: var(--icon-md)',
      '--spacing-icon-lg: var(--icon-lg)',
      '--z-index-dialog: var(--z-dialog)',
      '--z-index-menu: var(--z-menu)',
      '--z-index-popover: var(--z-popover)',
      '--z-index-toast: var(--z-toast)',
    ];
    for (const declaration of required) {
      expect(inlineTheme, `${declaration} missing from @theme inline`).toContain(declaration);
    }
  });

  it('declares @theme inline after the --color-* reset', () => {
    const reset = css.indexOf('--color-*: initial');
    const inline = css.indexOf('@theme inline');
    expect(reset, '--color-*: initial reset missing').toBeGreaterThan(-1);
    expect(inline, '@theme inline block missing').toBeGreaterThan(reset);
  });

  it('uses class-based dark mode, not prefers-color-scheme (spec D2)', () => {
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(/\.dark\s*{/);
  });
});

describe('scale values match the spec', () => {
  it('matches the spec scales', () => {
    expect(SCALES.radius.md).toBe('6px');
    expect(SCALES.control).toEqual({ sm: '32px', md: '36px', lg: '40px' });
    expect(SCALES.space).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '20px',
      '24px',
      '32px',
      '40px',
      '48px',
      '64px',
    ]);
  });
});

const TEXT_SURFACES = [
  'background',
  'surface',
  'surface-raised',
  'surface-subtle',
  'surface-muted',
  'surface-hover',
] as const;
const STATUS_FAMILIES = ['success', 'warning', 'danger', 'info', 'running'] as const;
const RGB_TOKENS = ['scrim', 'shadow-floating'] as const;

function themeVars(scheme: 'light' | 'dark'): Map<string, string> {
  const vars = new Map<string, string>();
  const selector = scheme === 'light' ? ':root' : '\\.dark';
  const pattern = new RegExp(`${selector}\\s*{([^{}]*)}`, 'g');
  for (const block of css.matchAll(pattern)) {
    const body = block[1] ?? '';
    if (!body.includes(`color-scheme: ${scheme}`)) continue;
    for (const decl of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      const name = decl[1];
      const value = decl[2];
      if (name !== undefined && value !== undefined) vars.set(name, value.trim());
    }
  }
  return vars;
}

function tokenValue(vars: Map<string, string>, theme: string, name: string): string {
  const value = vars.get(name);
  if (value === undefined) throw new Error(`--${name} missing from :root/.dark ${theme} block`);
  return value;
}

function linearize(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  const digits = match?.[1];
  if (digits === undefined) throw new Error(`contrast matrix expects a hex value, got: ${hex}`);
  const rgb = Number.parseInt(digits, 16);
  return (
    0.2126 * linearize((rgb >> 16) & 0xff) +
    0.7152 * linearize((rgb >> 8) & 0xff) +
    0.0722 * linearize(rgb & 0xff)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('contrast, computed from tokens.css (spec §10 pairing matrix)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const vars = themeVars(scheme);

    it(`${scheme}: every body-text foreground is >= 4.5:1 on every surface`, () => {
      const bodyForegrounds = [...vars.keys()].filter(
        (name) => name.startsWith('foreground') && name !== 'foreground-disabled',
      );
      expect(bodyForegrounds.length).toBeGreaterThan(0);
      for (const foreground of bodyForegrounds) {
        for (const surface of TEXT_SURFACES) {
          const ratio = contrastRatio(
            tokenValue(vars, scheme, foreground),
            tokenValue(vars, scheme, surface),
          );
          expect(
            ratio,
            `${scheme}: --${foreground} on --${surface} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${scheme}: control borders are >= 3:1 on surface and background`, () => {
      for (const border of ['border', 'border-strong'] as const) {
        for (const surface of ['surface', 'background'] as const) {
          const ratio = contrastRatio(
            tokenValue(vars, scheme, border),
            tokenValue(vars, scheme, surface),
          );
          expect(
            ratio,
            `${scheme}: --${border} on --${surface} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it(`${scheme}: each status foreground is >= 4.5:1 on its own surface`, () => {
      for (const status of STATUS_FAMILIES) {
        const ratio = contrastRatio(
          tokenValue(vars, scheme, `${status}-foreground`),
          tokenValue(vars, scheme, `${status}-surface`),
        );
        expect(
          ratio,
          `${scheme}: --${status}-foreground on --${status}-surface = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scheme}: accent is >= 4.5:1 on background and surface`, () => {
      for (const surface of ['background', 'surface'] as const) {
        const ratio = contrastRatio(
          tokenValue(vars, scheme, 'accent'),
          tokenValue(vars, scheme, surface),
        );
        expect(
          ratio,
          `${scheme}: --accent on --${surface} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scheme}: declares the rgb() tokens that stay outside the hex matrix`, () => {
      for (const name of RGB_TOKENS) {
        expect(vars.get(name), `${scheme}: --${name} declared`).toBeDefined();
        expect(vars.get(name), `${scheme}: --${name} is rgb(), not hex`).not.toMatch(/^#/);
      }
    });
  }
});
