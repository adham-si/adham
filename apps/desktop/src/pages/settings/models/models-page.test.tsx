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
  it('renders the accurate local-only note from locales, never hardcoded English', async () => {
    renderPage();
    expect(
      screen.getByText(
        'Nothing is assigned as default and there is no fallback chain. Local-only accounts dispatch on your device; cloud accounts dispatch to the configured cloud service only after explicit consent in Providers.',
      ),
    ).not.toBeNull();
    // no Preview banner over the working controls (delivery-closure item 1)
    expect(screen.queryByRole('note')).toBeNull();
    // no fallback-chain advertising anywhere on the page
    expect(
      screen.queryByText(
        'Configure default intelligence runtimes, model parameters, and automatic fallback chains.',
      ),
    ).toBeNull();
  });

  it('renders the note in Arabic with RTL intact', async () => {
    await i18n.changeLanguage('ar');
    renderPage();
    expect(
      screen.getByText(
        'لا يُعيَّن أي نموذج افتراضي ولا توجد سلسلة بدائل. حسابات «محلي فقط» تعمل على جهازك؛ حسابات السحابة تُرسل إلى الخدمة السحابية المضبوطة فقط بعد موافقة صريحة في صفحة «المزودون».',
      ),
    ).not.toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
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
                  kind: 'ollama_local',
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
                  kind: 'ollama_local',
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

  it('shows the raw id only when it differs from the display name', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'list_provider_accounts') {
        return {
          data: {
            accounts: [
              {
                accountId: 'acc-1',
                alias: 'Local Ollama',
                endpointUrl: 'http://127.0.0.1:11434',
                privacyClass: 'local_only',
                kind: 'ollama_local',
              },
            ],
          },
        };
      }
      if (cmd === 'list_provider_models') {
        return {
          data: {
            models: [
              {
                // qwen3.5 shape: human-readable label is the raw id itself
                modelId: 'qwen3.5:0.8b',
                digest: 'd9c89605f39a',
                humanLabel: 'qwen3.5:0.8b',
                privacyClass: 'local_only',
                kind: 'ollama_local',
                capabilities: {
                  streaming: 'supported',
                  structuredOutput: 'unknown',
                  toolProposals: 'supported',
                  thinking: 'supported',
                },
              },
            ],
          },
        };
      }
      throw new Error(`unexpected command ${String(cmd)}`);
    });
    renderPage();
    expect(await screen.findByText('qwen3.5:0.8b')).toBeDefined();
    const rows = screen.getAllByText('qwen3.5:0.8b');
    expect(rows).toHaveLength(1);
  });

  it('attributes rows to the account and renders only verified metadata and recorded capabilities', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'list_provider_accounts') {
        return {
          data: {
            accounts: [
              {
                accountId: 'acc-1',
                alias: 'Local Ollama',
                endpointUrl: 'http://127.0.0.1:11434',
                privacyClass: 'local_only',
                kind: 'ollama_local',
              },
            ],
          },
        };
      }
      if (cmd === 'list_provider_models') {
        return {
          data: {
            models: [
              {
                // reasoning-family NAME with unknown recorded capability:
                // the row must not infer thinking from the id
                modelId: 'deepseek-r1:1.5b',
                digest: 'aa11bb22cc33',
                humanLabel: 'DeepSeek R1 1.5B',
                privacyClass: 'local_only',
                kind: 'ollama_local',
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
      }
      throw new Error(`unexpected command ${String(cmd)}`);
    });
    renderPage();
    expect(await screen.findByText('DeepSeek R1 1.5B')).toBeDefined();
    expect(screen.getAllByText(/local ollama/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/sha256:aa11bb22cc33/)).toBeDefined();
    expect(screen.getByText(/streaming/i)).toBeDefined();
    // unknown stays unknown: no thinking/tool/structured chips of any locale
    expect(screen.queryByText(/thinking|تفكير|Мышление|思考/)).toBeNull();
    expect(
      screen.queryByText(/tool proposals|مقترحات أدوات|Предложения инструментов|工具调用/),
    ).toBeNull();
    expect(
      screen.queryByText(/structured output|مخرجات مهيكلة|Структурированный вывод|结构化输出/),
    ).toBeNull();
  });
});

describe('ModelsPage (Delivery G: per-provider sections)', () => {
  const googleModel = {
    modelId: 'gemini-2.5-flash',
    digest: '',
    humanLabel: 'Gemini 2.5 Flash',
    privacyClass: 'cloud_standard',
    kind: 'google_gemini',
    capabilities: {
      streaming: 'supported',
      structuredOutput: 'unknown',
      toolProposals: 'unknown',
      thinking: 'unknown',
    },
  };
  const ollamaModel = {
    modelId: 'qwen2.5:latest',
    digest: 'abc123def456',
    humanLabel: 'Qwen 2.5 (latest)',
    privacyClass: 'local_only',
    kind: 'ollama_local',
    capabilities: {
      streaming: 'supported',
      structuredOutput: 'unknown',
      toolProposals: 'unknown',
      thinking: 'unknown',
    },
  };

  function mockBothAccounts(invokeMock: ReturnType<typeof vi.fn>) {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') {
        return {
          data: {
            accounts: [
              {
                accountId: 'acc-ollama',
                alias: 'Local Ollama',
                endpointUrl: 'http://127.0.0.1:11434',
                privacyClass: 'local_only',
                kind: 'ollama_local',
              },
              {
                accountId: 'acc-google',
                alias: 'Google Gemini',
                endpointUrl: 'https://generativelanguage.googleapis.com',
                privacyClass: 'cloud_standard',
                kind: 'google_gemini',
              },
            ],
          },
        };
      }
      if (cmd === 'list_provider_models') {
        const accountId = (
          args as { request: { payload: { accountId: string } } }
        ).request.payload.accountId;
        return {
          data: { models: accountId === 'acc-google' ? [googleModel] : [ollamaModel] },
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
  }

  it('renders a section per connected account regardless of kind, with no digest line when the digest is empty', async () => {
    const invokeMock = vi.mocked(invoke);
    mockBothAccounts(invokeMock);
    renderPage();
    expect(await screen.findByText('Gemini 2.5 Flash')).toBeDefined();
    expect(screen.getByText('Qwen 2.5 (latest)')).toBeDefined();
    // each account owns its own section, keyed by alias — no name/prefix rules
    // and no kind or privacy-class filter
    const googleSection = screen
      .getByRole('heading', { name: 'Google Gemini' })
      .closest('section') as HTMLElement;
    expect(googleSection.textContent).toContain('Gemini 2.5 Flash');
    expect(googleSection.textContent).not.toContain('Qwen');
    // recorded digests still print as sha256:…, empty digests (cloud models)
    // never invent a fake digest line
    expect(screen.getByText(/sha256:abc123/)).toBeDefined();
    const digestLines = Array.from(googleSection.querySelectorAll('p')).filter((el) =>
      el.closest('li')?.textContent?.includes('Gemini 2.5 Flash'),
    );
    expect(digestLines.some((el) => el.textContent!.startsWith('Google Gemini · sha256:'))).toBe(
      false,
    );
  });

  it('says nothing about connected providers when no accounts exist', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_provider_accounts') return { data: { accounts: [] } };
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    expect(await screen.findByText('No provider accounts are connected yet.')).toBeDefined();
  });
});
