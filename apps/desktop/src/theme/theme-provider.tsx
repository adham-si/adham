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

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';

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
  const [systemDark, setSystemDark] = React.useState(() => mediaMatches(DARK_QUERY));
  const [systemReduceMotion, setSystemReduceMotion] = React.useState(() =>
    mediaMatches(REDUCE_MOTION_QUERY),
  );
  const [systemHighContrast, setSystemHighContrast] = React.useState(() =>
    mediaMatches(MORE_CONTRAST_QUERY),
  );
  const [palette] = React.useState<Palette>('neutral');

  // Track OS preferences live, so `system` choices follow the machine
  // changing at runtime rather than only at load.
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const watches: Array<[query: string, set: (matches: boolean) => void]> = [
      [DARK_QUERY, setSystemDark],
      [REDUCE_MOTION_QUERY, setSystemReduceMotion],
      [MORE_CONTRAST_QUERY, setSystemHighContrast],
    ];
    const cleanups = watches.map(([query, set]) => {
      const list = window.matchMedia(query);
      const onChange = (event: MediaQueryListEvent) => set(event.matches);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  const resolvedAppearance: 'light' | 'dark' =
    appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedAppearance === 'dark');
  }, [resolvedAppearance]);

  // Startup application for fonts, contrast and motion: the no-flash script
  // covers the theme class and language direction; everything else applies
  // here at root mount — not when Settings is first opened. The backend
  // snapshot re-applies authoritative values when it arrives. Re-runs on OS
  // changes so `system` contrast/motion choices stay live; the cache always
  // mirrors the last-confirmed backend values, so re-applying it cannot
  // clobber anything newer.
  React.useEffect(() => {
    applyPresentation(readPresentationCache(), {
      dark: systemDark,
      reduceMotion: systemReduceMotion,
      highContrast: systemHighContrast,
    });
  }, [systemDark, systemReduceMotion, systemHighContrast]);

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
