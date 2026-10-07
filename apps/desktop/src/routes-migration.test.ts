import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Lives outside src/routes/ deliberately: TanStack's file router treats every
// file in that directory as a route module and warns when none exports a Route.
const desktopRoot = path.resolve(__dirname, '..');
const routeSource = readFileSync(path.join(desktopRoot, 'src', 'routes', 'index.tsx'), 'utf8');
const rootSource = readFileSync(path.join(desktopRoot, 'src', 'routes', '__root.tsx'), 'utf8');
const stylesSource = readFileSync(path.join(desktopRoot, 'src', 'styles', 'index.css'), 'utf8');

/** Plan review focus #1: a direction-locked utility mirrors wrong in Arabic. */
const DIRECTION_LOCKED = /(^|\s)(left-|right-|ml-|mr-|pl-|pr-|text-left|text-right)/;

describe('route migration to semantic utilities', () => {
  it.each([
    ['routes/index.tsx', routeSource],
    ['routes/__root.tsx', rootSource],
    ['styles/index.css', stylesSource],
  ])('%s contains no hex literal', (_name, source) => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it.each([
    ['routes/index.tsx', routeSource],
    ['routes/__root.tsx', rootSource],
    ['styles/index.css', stylesSource],
  ])('%s contains no arbitrary var() value', (_name, source) => {
    expect(source).not.toMatch(/-?\[var\(/);
  });

  it.each([
    ['routes/index.tsx', routeSource],
    ['routes/__root.tsx', rootSource],
  ])('%s uses no direction-locked utility', (_name, source) => {
    expect(source).not.toMatch(DIRECTION_LOCKED);
  });

  it('index.tsx uses logical insets, never a fixed side', () => {
    expect(routeSource).not.toMatch(/(^|\s)(right-|left-)(?![\w-]*:)/);
    expect(routeSource).not.toMatch(/(^|\s)pr-\d/);
  });

  it('styles/index.css does not declare a scheme, which would override the theme', () => {
    expect(stylesSource).not.toMatch(/color-scheme\s*:/);
  });

  it('styles/index.css points body at the semantic tokens that exist', () => {
    expect(stylesSource).toContain('var(--background)');
    expect(stylesSource).toContain('var(--foreground)');
    expect(stylesSource).not.toContain('--color-bg-canvas');
  });

  it('index.tsx composes design-system components rather than reinventing them', () => {
    expect(routeSource).toMatch(/import\s+\{[^}]*\}\s+from\s+'@adham\/ui'/);
  });

  it('__root.tsx wraps the app in the theme provider', () => {
    expect(rootSource).toContain('ThemeProvider');
  });
});

/**
 * Regression guard for a bug that shipped silently: Tailwind v4 only scans
 * sources under the directory holding the CSS entry, so `packages/ui` — a
 * sibling workspace package — was never scanned. Every component class was
 * absent from the built CSS and nothing failed.
 */
describe('Tailwind source scanning reaches the shared packages', () => {
  const stylesDir = path.join(desktopRoot, 'src', 'styles');

  it.each([
    ['packages/ui/src', 'packages/ui/src/button.tsx'],
    ['packages/design-tokens/src', 'packages/design-tokens/src/index.ts'],
  ])('%s is declared as an @source and resolves to a real directory', (declared, marker) => {
    const directive = new RegExp(`@source\\s+"([^"]*${declared.replace('/', '\\/')})"`).exec(
      stylesSource,
    );
    expect(directive, `@source for ${declared} missing from styles/index.css`).not.toBeNull();

    const resolved = path.resolve(stylesDir, directive?.[1] ?? '');
    expect(existsSync(resolved), `@source "${directive?.[1]}" resolves to ${resolved}`).toBe(true);
    // A wrong depth still resolves to *a* directory only if it exists; assert the
    // expected content is really there so a miscount cannot pass.
    expect(existsSync(path.join(resolved, path.basename(marker)))).toBe(true);
  });

  it('every @source directive resolves to an existing directory', () => {
    const directives = [...stylesSource.matchAll(/@source\s+"([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(directives.length).toBeGreaterThan(0);
    for (const directive of directives) {
      expect(existsSync(path.resolve(stylesDir, directive)), directive).toBe(true);
    }
  });
});
