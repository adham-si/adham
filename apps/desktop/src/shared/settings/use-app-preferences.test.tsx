import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ThemeProvider } from '@/theme/theme-provider';
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

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('useAppPreferences', () => {
  it('loads backend values and applies them to the document', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_app_preferences') {
        return { preferences: BACKEND_PREFS, revision: 2 };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    let latest: ReturnType<typeof useAppPreferences> | null = null;
    renderHarness((api) => {
      latest = api;
    });
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.fontFamily).toBe('serif');
    expect(document.documentElement.dataset.highContrast).toBe('enabled');
    expect(document.documentElement.dataset.reducedMotion).toBe('reduce');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
    expect(latest?.syncState).toBe('synced');
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
    let latest: ReturnType<typeof useAppPreferences> | null = null;
    renderHarness((api) => {
      latest = api;
    });
    await waitFor(() => expect(screen.getByTestId('sync').textContent).toBe('synced'));
    await act(async () => {
      await latest?.update({ appearance: 'light' });
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
    let latest: ReturnType<typeof useAppPreferences> | null = null;
    renderHarness((api) => {
      latest = api;
    });
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark'));
    await act(async () => {
      await latest?.update({ appearance: 'light' });
    });
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('validation'));
    // Rejected write changes nothing observable.
    expect(screen.getByTestId('appearance').textContent).toBe('dark');
    expect(window.localStorage.getItem('adham.appearance')).toBe('dark');
  });
});
