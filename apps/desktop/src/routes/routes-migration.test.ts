import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(__dirname, '..', '..');
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

  it('index.tsx uses the logical inset for the send button', () => {
    expect(routeSource).toContain('end-3');
    expect(routeSource).not.toContain('right-3');
  });

  it('index.tsx insets the textarea logically so the button never covers text', () => {
    expect(routeSource).toContain('pe-28');
    expect(routeSource).not.toContain('pr-24');
  });

  it('styles/index.css does not declare a scheme, which would override the theme', () => {
    expect(stylesSource).not.toMatch(/color-scheme\s*:/);
  });

  it('styles/index.css points body at the semantic tokens that exist', () => {
    expect(stylesSource).toContain('var(--background)');
    expect(stylesSource).toContain('var(--foreground)');
    expect(stylesSource).not.toContain('--color-bg-canvas');
  });

  it('index.tsx delegates to the design-system components', () => {
    expect(routeSource).toContain('MessageCard');
    expect(routeSource).toContain('Textarea');
  });

  it('__root.tsx wraps the app in the theme provider', () => {
    expect(rootSource).toContain('ThemeProvider');
  });
});
