import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/shared/i18n';
import { InfoPage } from './info-page';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const PLATFORM = {
  os: 'macos',
  arch: 'aarch64',
  hasNativeTitlebarControls: true,
  appVersion: '0.1.0',
  buildProfile: 'debug',
};
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
      <InfoPage />
    </QueryClientProvider>,
  );
}

function mockBackend() {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === 'get_platform_info') return PLATFORM;
    if (cmd === 'get_storage_status') return STORAGE;
    throw new Error(`unexpected command ${cmd}`);
  });
}

function stubClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  window.localStorage.clear();
});

describe('InfoPage (authoritative about + sanitized diagnostics)', () => {
  it('shows real build identity with no fabricated fallbacks or updater', async () => {
    mockBackend();
    stubClipboard(async () => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('0.1.0')).not.toBeNull());
    expect(screen.getByText('debug')).not.toBeNull();
    expect(screen.queryByText(/check for updates/i)).toBeNull();
    expect(screen.queryByText('2026.10.07-nightly')).toBeNull();
    expect(screen.queryByText(/SQLite v3\.45/)).toBeNull();
  });

  it('previews exactly the allowlist and copies it on success', async () => {
    mockBackend();
    stubClipboard(async () => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('0.1.0')).not.toBeNull());
    const preview = screen.getByTestId('diagnostics-preview');
    expect(preview.textContent).toContain('"appVersion": "0.1.0"');
    expect(preview.textContent).toContain('"os": "macos"');
    expect(preview.textContent).not.toContain('/tmp/adham-canary-data');
    expect(preview.textContent).not.toContain('dataDir');

    fireEvent.click(screen.getByRole('button', { name: /copy json/i }));
    await waitFor(() => expect(screen.getByText(/copied ✓/i)).not.toBeNull());
  });

  it('reports clipboard failure instead of pretending the copy worked', async () => {
    mockBackend();
    stubClipboard(async () => {
      throw new Error('clipboard denied');
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('0.1.0')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /copy json/i }));
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
    expect(screen.queryByText(/copied ✓/i)).toBeNull();
  });
});
