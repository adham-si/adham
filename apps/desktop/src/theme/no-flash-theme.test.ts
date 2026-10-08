import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(__dirname, '..', '..');
const html = readFileSync(path.join(desktopRoot, 'index.html'), 'utf8');
const script = readFileSync(path.join(desktopRoot, 'public', 'no-flash-theme.js'), 'utf8');

describe('no-flash theme script', () => {
  // Review focus #4: Tauri's CSP is `script-src 'self'` with no
  // `'unsafe-inline'`, so an inline script would be blocked and the theme
  // would flash on every launch.
  it('index.html contains no inline <script> block', () => {
    const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
      (match) => !/\bsrc\s*=/i.test(match[1] ?? '') && (match[2] ?? '').trim() !== '',
    );
    expect(inlineScripts.map((match) => match[0])).toEqual([]);
  });

  it('references the script with src, not inline', () => {
    expect(html).toContain('<script src="/no-flash-theme.js"></script>');
  });

  it('is a classic script: no type=module and no defer, so it runs before paint', () => {
    const tag = /<script[^>]*no-flash-theme\.js[^>]*>/i.exec(html)?.[0] ?? '';
    expect(tag).not.toMatch(/type\s*=\s*["']module["']/i);
    expect(tag).not.toMatch(/\bdefer\b/i);
    expect(tag).not.toMatch(/\basync\b/i);
  });

  it('is referenced from <head>, before the app bundle', () => {
    const head = html.slice(0, html.toLowerCase().indexOf('</head>'));
    expect(head).toContain('no-flash-theme.js');
    expect(head).not.toContain('/src/main.tsx');
  });

  it('sets className, dir and lang together', () => {
    // Setting only the theme class still leaves an LTR frame on an Arabic
    // machine, which is the same flash problem in a different guise.
    expect(script).toContain("classList.toggle('dark'");
    expect(script).toContain("setAttribute('dir'");
    expect(script).toContain("setAttribute('lang'");
  });

  it('resolves the system preference when nothing is stored', () => {
    expect(script).toContain('prefers-color-scheme: dark');
    // Compared loosely: the script builds the key through the STORAGE_KEY const
    // rather than inlining the literal, and this asserts behaviour, not spelling.
    expect(script).toMatch(/getItem\(STORAGE_KEY\)|getItem\('adham\.appearance'\)/);
    expect(script).toContain('adham.appearance');
  });

  it('contains no ES module syntax, which would need type="module"', () => {
    expect(script).not.toMatch(/^\s*(export|import)\s/m);
  });
});
