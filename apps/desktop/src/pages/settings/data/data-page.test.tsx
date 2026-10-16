import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/shared/i18n';
import { DataPage } from './data-page';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const STORAGE = {
  status: 'ready',
  journalMode: 'wal',
  schemaVersion: 1,
  dataDir: '/tmp/adham-canary-data',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataPage />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  window.localStorage.clear();
  // Test files share the i18n singleton: never inherit another file's locale.
  const { default: i18n } = await import('@/shared/i18n');
  await i18n.changeLanguage('en');
});

describe('DataPage (authoritative storage)', () => {
  it('shows the resolved storage location with no fabricated facts', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_storage_status') return STORAGE;
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('/tmp/adham-canary-data')).not.toBeNull());
    expect(screen.queryByText('Encrypted Local')).toBeNull();
    expect(screen.queryByText('%LOCALAPPDATA%\\Adham\\data')).toBeNull();
    expect(screen.queryByText(/vacuum/i)).toBeNull();
    expect(screen.queryByText(/clear cache/i)).toBeNull();
    // Status badge is localized, never the raw backend string.
    expect(screen.getByText('Ready')).not.toBeNull();
    expect(screen.queryByText('ready', { exact: true })).toBeNull();
  });

  it('shows an unavailable state with retry instead of fallback facts', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('storage down'));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).not.toBeNull());
    // No fabricated journal/schema fallbacks while unavailable.
    expect(screen.queryByText('WAL (Write-Ahead)')).toBeNull();
    expect(screen.queryByText('v1.0.0')).toBeNull();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_storage_status') return STORAGE;
      throw new Error(`unexpected command ${cmd}`);
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('/tmp/adham-canary-data')).not.toBeNull());
  });

  it('rebuilds through the real backend operation with confirm and result', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_storage_status') return STORAGE;
      if (cmd === 'admin_rebuild_projections') return { replayedCount: 5 };
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('/tmp/adham-canary-data')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));
    // Confirm step: nothing dispatched yet.
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('admin_rebuild_projections');
    const confirm = screen.getByRole('button', { name: /confirm rebuild/i });
    fireEvent.click(confirm);
    // Duplicate-click protection: second click while pending dispatches nothing new.
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText(/5/)).not.toBeNull());
    const rebuildCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'admin_rebuild_projections');
    expect(rebuildCalls).toHaveLength(1);
  });

  it('reports rebuild failures without pretending success', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_storage_status') return STORAGE;
      if (cmd === 'admin_rebuild_projections') {
        throw {
          protocolVersion: 1,
          code: 'InternalError',
          messageKey: 'error.internalError',
          retryable: true,
          correlationId: 'c',
          fieldErrors: [],
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('/tmp/adham-canary-data')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm rebuild/i }));
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
  });
});
