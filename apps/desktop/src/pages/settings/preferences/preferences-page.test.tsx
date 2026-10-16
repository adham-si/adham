import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { PreferencesPage } from './preferences-page';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const BACKEND_PREFS = {
  appearance: 'dark',
  language: 'en',
  fontFamily: 'default',
  fontSize: 'md',
  highContrast: 'system',
  reducedMotion: 'system',
  enterToSend: true,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PreferencesPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  const { default: i18n } = await import('@/shared/i18n');
  await i18n.changeLanguage('en');
});

describe('PreferencesPage with a real backend', () => {
  it('shares save state across mounted instances', async () => {
    // Regression: the page note and the control use separate hook instances.
    // A failed save from the control must surface in the page note.
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...BACKEND_PREFS }, revision: 2 };
      }
      throw new Error('transport down');
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
  });

  it('renders backend values and writes through the control with its base revision', async () => {
    let revision = 2;
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...BACKEND_PREFS }, revision };
      }
      if (cmd === 'update_app_preferences') {
        const payload = (
          args as { payload: { preferences: typeof BACKEND_PREFS; baseRevision: number } }
        ).payload;
        expect(payload.baseRevision).toBe(2);
        revision = 3;
        return { preferences: payload.preferences, revision };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    const themeSelect = screen.getByLabelText('Theme') as HTMLSelectElement;

    fireEvent.change(themeSelect, { target: { value: 'light' } });
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        'update_app_preferences',
        expect.objectContaining({
          payload: expect.objectContaining({
            preferences: expect.objectContaining({ appearance: 'light' }),
            baseRevision: 2,
          }),
        }),
      ),
    );
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(window.localStorage.getItem('adham.appearance')).toBe('light');
  });

  it('shows a failed save honestly and recovers through explicit retry', async () => {
    let failUpdate = true;
    let stored = { preferences: { ...BACKEND_PREFS }, revision: 2 };
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...stored.preferences }, revision: stored.revision };
      }
      if (cmd === 'update_app_preferences') {
        if (failUpdate) throw new Error('transport down');
        const payload = (
          args as { payload: { preferences: typeof BACKEND_PREFS; baseRevision: number } }
        ).payload;
        stored = { preferences: { ...payload.preferences }, revision: stored.revision + 1 };
        return { preferences: { ...stored.preferences }, revision: stored.revision };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    const themeSelect = screen.getByLabelText('Theme') as HTMLSelectElement;

    fireEvent.change(themeSelect, { target: { value: 'light' } });
    // Failed write: no save claimed, control snaps back, retry offered.
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(retry).not.toBeNull();
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');

    failUpdate = false;
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry/i })).toBeNull());
  });

  it('cancels reset without dispatching anything', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...BACKEND_PREFS }, revision: 2 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'reset_app_preferences'),
    ).toHaveLength(0);
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
  });

  it('resets through the contract and applies the confirmed defaults', async () => {
    const DEFAULTS = {
      appearance: 'system',
      language: 'en',
      fontFamily: 'default',
      fontSize: 'md',
      highContrast: 'system',
      reducedMotion: 'system',
      enterToSend: true,
    };
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...BACKEND_PREFS }, revision: 2 };
      }
      if (cmd === 'reset_app_preferences') {
        return { preferences: DEFAULTS, revision: 3 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm reset/i }));
    // Confirming unmounts immediately; the shared FIFO serializes any repeat.
    await waitFor(() => expect(screen.getByText(/defaults restored/i)).not.toBeNull());
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'reset_app_preferences'),
    ).toHaveLength(1);
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('adham.appearance')).toBe('system');
  });

  it('reports a failed reset without changing anything', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...BACKEND_PREFS }, revision: 2 };
      }
      if (cmd === 'reset_app_preferences') {
        throw new Error('transport down');
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark'),
    );
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm reset/i }));
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
  });
});
