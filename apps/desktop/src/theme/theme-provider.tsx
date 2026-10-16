import * as React from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  ThemeContext,
  type Appearance,
  type Palette,
  type ThemeContextValue,
} from './theme-context';
import { applyPresentation, readPresentationCache } from '@/shared/settings/preferences-store';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: in-memory state still drives this session.
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readAppearance(): Appearance {
  const stored = readStorage(APPEARANCE_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Owns the user's appearance choice and resolves it onto `<html class="dark">`.
 *
 * The first paint is handled by `public/no-flash-theme.js`, which reads the same
 * storage key and sets className, dir and lang before React runs. This provider
 * keeps that state in sync afterwards; it is not the first thing to apply it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = React.useState<Appearance>(readAppearance);
  const [systemDark, setSystemDark] = React.useState(systemPrefersDark);
  const [palette] = React.useState<Palette>('neutral');

  // Track the OS preference live, so `system` follows the machine changing at
  // runtime rather than only at load.
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedAppearance: 'light' | 'dark' =
    appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedAppearance === 'dark');
  }, [resolvedAppearance]);

  // Startup application for fonts, contrast and motion: the no-flash script
  // covers the theme class and language direction; everything else applies
  // here at root mount — not when Settings is first opened. The backend
  // snapshot re-applies authoritative values when it arrives.
  React.useEffect(() => {
    applyPresentation(readPresentationCache());
  }, []);

  const setAppearance = React.useCallback((next: Appearance) => {
    setAppearanceState(next);
    writeStorage(APPEARANCE_STORAGE_KEY, next);
  }, []);

  const setPalette = React.useCallback((next: Palette) => {
    // v1 accepts only neutral. Accepting more would silently do nothing, which
    // is worse than refusing.
    if (next !== 'neutral') throw new Error(`unsupported palette: ${next}`);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ appearance, resolvedAppearance, setAppearance, palette, setPalette }),
    [appearance, resolvedAppearance, setAppearance, palette, setPalette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export { ThemeContext };
