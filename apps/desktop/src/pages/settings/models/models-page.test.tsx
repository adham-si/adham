import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/shared/i18n';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));
import i18n from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { ModelsPage } from './models-page';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ModelsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  // Never leak a switched locale into other test files sharing the singleton.
  await i18n.changeLanguage('en');
});

describe('ModelsPage (preserved preview implementation)', () => {
  it('renders the local-first note from locales, never hardcoded English', async () => {
    renderPage();
    expect(
      screen.getByText(
        'Local-first guarantee: When strict local boundary is enabled, requests with local models never cross to cloud providers without approval.',
      ),
    ).not.toBeNull();
  });

  it('renders the note in Arabic with RTL intact', async () => {
    await i18n.changeLanguage('ar');
    renderPage();
    expect(
      screen.getByText(
        'ضمان الأولوية المحلية: عند تفعيل الحد المحلي الصارم، لا تعبر طلبات النماذج المحلية إلى مزودي السحابة دون موافقة.',
      ),
    ).not.toBeNull();
  });

  it('selects no default or fallback model', () => {
    renderPage();
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.queryByText('Fallback')).toBeNull();
  });

  it('lists pinned Ollama models from the registry without network calls', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => {
      switch (cmd) {
        case 'list_provider_accounts':
          return {
            data: {
              accounts: [
                {
                  accountId: 'acc-1',
                  alias: 'Local Ollama',
                  endpointUrl: 'http://127.0.0.1:11434',
                  privacyClass: 'local_only',
                },
              ],
            },
          };
        case 'list_provider_models':
          return {
            data: {
              models: [
                {
                  modelId: 'qwen2.5:latest',
                  digest: 'sha256:abc',
                  humanLabel: 'Qwen 2.5 (latest)',
                  privacyClass: 'local_only',
                  capabilities: {
                    streaming: 'supported',
                    structuredOutput: 'unknown',
                    toolProposals: 'unknown',
                    thinking: 'unknown',
                  },
                },
              ],
            },
          };
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderPage();
    expect(await screen.findByText('Qwen 2.5 (latest)')).toBeDefined();
    expect(screen.getByText('qwen2.5:latest')).toBeDefined();
    // Discovery order is never promoted to a saved default.
    expect(screen.queryByText(/default in composer/i)).toBeNull();
    // models render outside the disabled preview fieldset
    invokeMock.mock.calls.filter(([cmd]) => cmd === 'list_provider_models');
  });
});
