import * as React from 'react';
import { ThemeContext, type ThemeContextValue } from './theme-context';

/** Reads the active theme. Throws outside a ThemeProvider rather than defaulting. */
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (context === null) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
