import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { normalizeLanguage } from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { resetPreferencesSyncForTests } from './use-app-preferences';
import { useAppPreferences } from './use-app-preferences';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const BACKEND_PREFS = {
  appearance: 'dark',
  language: 'ar',
  fontFamily: 'serif',
  fontSize: 'lg',
  highContrast: 'enabled',
  reducedMotion: 'reduce',
  enterToSend: false,
};

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useAppPreferences>) => void }) {
  const api = useAppPreferences();
  React.useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return (
    <div>
      <span data-testid="appearance">{api.preferences.appearance}</span>
      <span data-testid="sync">{api.syncState}</span>
      <span data-testid="error">{api.saveError ? api.saveError.kind : 'none'}</span>
    </div>
  );
}

function renderHarness(onReady: (api: ReturnType<typeof useAppPreferences>) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Harness onReady={onReady} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  resetPreferencesSyncForTests();
  const { default: i18n } = await import('@/shared/i18n');
  await i18n.changeLanguage('en');
});

describe('useAppPreferences', () => {
  it('loads backend values and applies them to the document', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: BACKEND_PREFS, revision: 2 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    const seen: { api?: ReturnType<typeof useAppPreferences> } = {};
    renderHarness((api) => {
      seen.api = api;
    });
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.fontFamily).toBe('serif');
    expect(document.documentElement.dataset.highContrast).toBe('enabled');
    expect(document.documentElement.dataset.reducedMotion).toBe('reduce');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
    expect(seen.api?.syncState).toBe('synced');
  });

  it('refreshes the full presentation cache from the authoritative load', async () => {
    // Cache starts empty (e.g. cleared site data): every mirrored key must
    // come back from the backend snapshot, or the next offline startup falls
    // back to defaults for the keys no other writer touches.
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: BACKEND_PREFS, revision: 2 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderHarness(() => {});
    await waitFor(() => expect(window.localStorage.getItem('adham.font-size')).toBe('lg'));
    expect(window.localStorage.getItem('adham.high-contrast')).toBe('enabled');
    expect(window.localStorage.getItem('adham.reduced-motion')).toBe('reduce');
  });

  it('writes through the backend and mirrors the cache on success', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return {
          preferences: {
            appearance: 'system',
            language: 'en',
            fontFamily: 'default',
            fontSize: 'md',
            highContrast: 'system',
            reducedMotion: 'system',
            enterToSend: true,
          },
          revision: 1,
        };
      }
      if (cmd === 'update_app_preferences') {
        const payload = (args as { payload: { preferences: unknown; baseRevision: number } })
          .payload;
        return { preferences: payload.preferences, revision: 2 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    const seen: { api?: ReturnType<typeof useAppPreferences> } = {};
    renderHarness((api) => {
      seen.api = api;
    });
    await waitFor(() => expect(screen.getByTestId('sync').textContent).toBe('synced'));
    await act(async () => {
      await seen.api?.update({ appearance: 'light' });
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('update_app_preferences', {
      payload: expect.objectContaining({ baseRevision: 1 }),
    });
    expect(window.localStorage.getItem('adham.appearance')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('never applies a write the backend rejects', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return {
          preferences: {
            appearance: 'dark',
            language: 'en',
            fontFamily: 'default',
            fontSize: 'md',
            highContrast: 'system',
            reducedMotion: 'system',
            enterToSend: true,
          },
          revision: 1,
        };
      }
      if (cmd === 'update_app_preferences') {
        throw {
          protocolVersion: 1,
          code: 'InvalidRequest',
          messageKey: 'error.validationFailed',
          retryable: false,
          correlationId: 'c',
          fieldErrors: [],
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    const seen: { api?: ReturnType<typeof useAppPreferences> } = {};
    renderHarness((api) => {
      seen.api = api;
    });
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark'));
    await act(async () => {
      await seen.api?.update({ appearance: 'light' });
    });
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('validation'));
    // Rejected write changes nothing observable.
    expect(screen.getByTestId('appearance').textContent).toBe('dark');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
  });

  it('persists first-launch OS language detection instead of overriding it', async () => {
    const { default: i18n } = await import('@/shared/i18n');
    await i18n.changeLanguage('ar');
    window.localStorage.removeItem('adham.language');
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return {
          preferences: {
            appearance: 'system',
            language: 'en',
            fontFamily: 'default',
            fontSize: 'md',
            highContrast: 'system',
            reducedMotion: 'system',
            enterToSend: true,
          },
          revision: 0,
        };
      }
      if (cmd === 'update_app_preferences') {
        const payload = (
          args as { payload: { preferences: Record<string, unknown>; baseRevision: number } }
        ).payload;
        return { preferences: payload.preferences, revision: 1 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderHarness(() => {});
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        'update_app_preferences',
        expect.objectContaining({
          payload: expect.objectContaining({
            preferences: expect.objectContaining({ language: 'ar' }),
          }),
        }),
      ),
    );
    // Detection stands: the UI was never forced back to English.
    expect(normalizeLanguage(i18n.language)).toBe('ar');
  });

  it('persists first-launch detection once across mounted instances', async () => {
    const { default: i18n } = await import('@/shared/i18n');
    await i18n.changeLanguage('ar');
    window.localStorage.removeItem('adham.language');
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return {
          preferences: {
            appearance: 'system',
            language: 'en',
            fontFamily: 'default',
            fontSize: 'md',
            highContrast: 'system',
            reducedMotion: 'system',
            enterToSend: true,
          },
          revision: 0,
        };
      }
      if (cmd === 'update_app_preferences') {
        const payload = (
          args as { payload: { preferences: Record<string, unknown>; baseRevision: number } }
        ).payload;
        return { preferences: payload.preferences, revision: 1 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    // Two live instances (PreferencesHost + route): only one may persist.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Harness onReady={() => {}} />
          <Harness onReady={() => {}} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(
            ([cmd, args]) =>
              cmd === 'update_app_preferences' &&
              (args as { payload: { preferences: { language: string } } }).payload.preferences
                .language === 'ar',
          ),
      ).toHaveLength(1),
    );
  });

  it('serializes concurrent updates from all mounted instances through one queue', async () => {
    let stored = {
      preferences: {
        appearance: 'system',
        language: 'en',
        fontFamily: 'default',
        fontSize: 'md',
        highContrast: 'system',
        reducedMotion: 'system',
        enterToSend: true,
      },
      revision: 1,
    };
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: { ...stored.preferences }, revision: stored.revision };
      }
      if (cmd === 'update_app_preferences') {
        const payload = (
          args as { payload: { preferences: typeof stored.preferences; baseRevision: number } }
        ).payload;
        // Backend revision guard: stale bases conflict instead of overwriting.
        if (payload.baseRevision !== stored.revision) {
          throw {
            protocolVersion: 1,
            code: 'ConcurrencyConflict',
            messageKey: 'error.preferencesConflict',
            retryable: true,
            correlationId: 'c',
            fieldErrors: [],
          };
        }
        stored = { preferences: { ...payload.preferences }, revision: stored.revision + 1 };
        return { preferences: { ...stored.preferences }, revision: stored.revision };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    const seenA: { api?: ReturnType<typeof useAppPreferences> } = {};
    const seenB: { api?: ReturnType<typeof useAppPreferences> } = {};
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Harness
            onReady={(api) => {
              seenA.api = api;
            }}
          />
          <Harness
            onReady={(api) => {
              seenB.api = api;
            }}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(seenA.api?.syncState).toBe('synced'));
    await act(async () => {
      await Promise.all([
        seenA.api?.update({ appearance: 'dark' }),
        seenB.api?.update({ language: 'ar' }),
      ]);
    });
    const bases = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'update_app_preferences')
      .map(([, args]) => (args as { payload: { baseRevision: number } }).payload.baseRevision);
    // Ordered, no conflict retry: second update observed the first.
    expect(bases).toEqual([1, 2]);
    expect(stored.revision).toBe(3);
    expect(stored.preferences).toMatchObject({ appearance: 'dark', language: 'ar' });
  });
});
