import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from './use-theme';
import { ThemeProvider } from './theme-provider';

type Captured = { setPalette: (palette: 'neutral') => void };

let captured: Captured | null = null;

function AppearanceControl() {
  const { appearance, resolvedAppearance, setAppearance, palette, setPalette } = useTheme();
  captured = { setPalette };
  return (
    <div>
      <p data-testid="state">{`${appearance}/${resolvedAppearance}/${palette}`}</p>
      <button type="button" onClick={() => setAppearance('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setAppearance('light')}>
        light
      </button>
      <button type="button" onClick={() => setAppearance('system')}>
        system
      </button>
    </div>
  );
}

function setSystemPrefersDark(dark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('ThemeProvider', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    setSystemPrefersDark(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('defaults to system and resolves light when the OS is light', () => {
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('system/light/neutral');
  });

  it('system resolves dark when the OS is dark', () => {
    setSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('system/dark/neutral');
  });

  it('setAppearance applies the dark class to the document element', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setAppearance light removes the dark class', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'dark' }));
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('an explicit choice overrides the OS preference', async () => {
    const user = userEvent.setup();
    setSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(screen.getByTestId('state').textContent).toBe('light/light/neutral');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists the choice to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
  });

  it('reads a persisted choice on mount', () => {
    window.localStorage.setItem('adham.appearance', 'dark');
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('dark/dark/neutral');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tracks a live OS change while on system', () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => {
        listener = handler;
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('system/light/neutral');
    act(() => {
      listener?.({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByTestId('state').textContent).toBe('system/dark/neutral');
  });

  it('accepts only the neutral palette in v1', () => {
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    // Refusing loudly is the point: silently accepting zinc in v1 would ship a
    // setting that does nothing.
    expect(() => captured?.setPalette('zinc' as 'neutral')).toThrow(/unsupported palette/);
  });

  it('accepts neutral without throwing', () => {
    render(
      <ThemeProvider>
        <AppearanceControl />
      </ThemeProvider>,
    );
    expect(() => captured?.setPalette('neutral')).not.toThrow();
  });

  it('throws when useTheme is used outside a provider', () => {
    function Orphan() {
      useTheme();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/ThemeProvider/);
  });
});
