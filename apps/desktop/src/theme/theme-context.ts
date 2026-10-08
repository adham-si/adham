import * as React from 'react';

export type Appearance = 'system' | 'light' | 'dark';
/** v1 ships neutral only. Zinc and Slate are a deliberate diff, not a refactor. */
export type Palette = 'neutral';

export const APPEARANCE_STORAGE_KEY = 'adham.appearance';
export const LANGUAGE_STORAGE_KEY = 'adham.language';

export interface ThemeContextValue {
  appearance: Appearance;
  resolvedAppearance: 'light' | 'dark';
  setAppearance: (appearance: Appearance) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

export const ThemeContext = React.createContext<ThemeContextValue | null>(null);
