import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/shared/i18n';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));
import type { ProviderModelDto } from '@adham/contracts-generated';
import i18n from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { ModelsPage } from './models-page';

const invokeMock = vi.mocked(invoke);

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

const ollamaModel = {
  modelId: 'qwen2.5:latest',
  digest: 'sha256:abc',
  humanLabel: 'Qwen 2.5 (latest)',
  privacyClass: 'local_only',
  capabilities: {
    streaming: 'supported',
    structuredOutput: 'unknown',
    toolProposals: 'unknown',
    thinking: 'unknown',
  } as const,
};

const googleModel = {
  modelId: 'gemini-2.5-flash',
  digest: '',
  humanLabel: 'Gemini 2.5 Flash',
  privacyClass: 'cloud_standard',
  capabilities: {
    streaming: 'supported',
    structuredOutput: 'supported',
    toolProposals: 'supported',
    thinking: 'unknown',
  } as const,
};

type Dto = ProviderModelDto;

function accountsPayload() {
  return {
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
  };
}

function mockModels(invokeMock: ReturnType<typeof vi.fn>, perAccount: Record<string, Dto[]>) {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'list_provider_accounts') return { data: accountsPayload() };
    if (cmd === 'list_provider_models') {
      const accountId = (args as { request: { payload: { accountId: string } } }).request.payload
        .accountId;
      return { data: { models: perAccount[accountId] ?? [] } };
    }
    throw new Error(`unexpected command ${cmd}`);
  });
}

describe('ModelsPage (header + curation intro)', () => {
  it('opens with the manage-oriented subtext, never the default-chain disclaimer', () => {
    renderPage();
    expect(
      screen.getByText(
        'Manage models discovered from your connected providers. Enable or favorite models to make them available in chat.',
      ),
    ).not.toBeNull();
    // the old "Nothing is assigned as default" header sentence survives below
    // as the honest delivery note, never as the page introduction
    expect(
      screen.queryByText('-models discovered from your registered provider endpoints.'),
    ).toBeNull();
  });

  it('renders the subtext in Arabic with RTL intact', async () => {
    await i18n.changeLanguage('ar');
    renderPage();
    expect(
      screen.getByText(
        'أدر النماذج المكتشفة من مزوديك المتصلين. فعّل النماذج أو أضفها للمفضلة لتتوفر في المحادثة.',
      ),
    ).not.toBeNull();
  });

  it('selects no default or fallback model', () => {
    renderPage();
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.queryByText('Fallback')).toBeNull();
  });

  it('says nothing about connected providers when no accounts exist', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_provider_accounts') return { data: { accounts: [] } };
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    expect(await screen.findByText('No provider accounts are connected yet.')).toBeDefined();
  });
});

describe('ModelsPage (registry sections)', () => {
  it('lists pinned models per connected account without hashes and without network calls', async () => {
    mockModels(invokeMock, {
      'acc-ollama': [ollamaModel],
      'acc-google': [googleModel],
    });
    renderPage();
    expect(await screen.findByText('Qwen 2.5 (latest)')).toBeDefined();
    expect(screen.getByText('qwen2.5:latest')).toBeDefined();
    expect(screen.getByText('Gemini 2.5 Flash')).toBeDefined();
    expect(screen.getByText('gemini-2.5-flash')).toBeDefined();
    // internal digests (sha256:…) stay backend-only
    expect(screen.queryByText(/sha256:/)).toBeNull();
  });

  it('shows the raw id only when it differs from the display name', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') return { data: accountsPayload() };
      if (cmd === 'list_provider_models') {
        const accountId = (args as { request: { payload: { accountId: string } } }).request.payload
          .accountId;
        if (accountId !== 'acc-ollama') return { data: { models: [] } };
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

  it('promotes a raw descriptive label from the provider into a clean title', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') return { data: accountsPayload() };
      if (cmd === 'list_provider_models') {
        const accountId = (args as { request: { payload: { accountId: string } } }).request.payload
          .accountId;
        if (accountId !== 'acc-google') return { data: { models: [] } };
        return {
          data: {
            models: [
              {
                modelId: 'aqa',
                digest: '',
                humanLabel: 'Model that performs Attributed Question Answering.',
                privacyClass: 'cloud_standard',
                kind: 'google_gemini',
                capabilities: {
                  streaming: 'supported',
                  structuredOutput: 'unknown',
                  toolProposals: 'unknown',
                  thinking: 'unknown',
                },
              },
              {
                modelId: 'antigravity-preview-05-2026',
                digest: '',
                humanLabel: 'antigravity-preview-05-2026',
                privacyClass: 'cloud_standard',
                kind: 'google_gemini',
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
    // the description sentence never survives as the visible title
    expect(screen.queryByText(/Model that performs/i)).toBeNull();
    expect(await screen.findByText('AQA')).toBeDefined();
    expect(screen.getByText('Antigravity Preview')).toBeDefined();
  });

  it('attributes rows to the account and renders only recorded supported capabilities', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') return { data: accountsPayload() };
      if (cmd === 'list_provider_models') {
        const accountId = (args as { request: { payload: { accountId: string } } }).request.payload
          .accountId;
        if (accountId !== 'acc-ollama') return { data: { models: [] } };
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
    expect(screen.queryByText(/sha256:aa11bb22cc33/)).toBeNull();
    // only recorded supported capabilities earn badges — never name inference
    expect(screen.queryByLabelText(/thinking/i)).toBeNull();
    expect(screen.queryByLabelText(/tool proposals/i)).toBeNull();
  });

  it('renders icon badges with accessible names for recorded thinking and tool support', async () => {
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': [googleModel] });
    renderPage();
    expect(await screen.findByText('Gemini 2.5 Flash')).toBeDefined();
    const googleSection = screen
      .getByRole('heading', { name: 'Google Gemini' })
      .closest('section') as HTMLElement;
    expect(within(googleSection).getByLabelText(/tool proposals/i)).toBeDefined();
    // streaming is assumed 2026-table stakes and never shown as a badge
    expect(within(googleSection).queryByLabelText(/streaming/i)).toBeNull();
  });
});

describe('ModelsPage (search, chips, curation)', () => {
  it('filters models by search across title, id and provider alias', async () => {
    const user = userEvent.setup();
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': [googleModel] });
    renderPage();
    expect(await screen.findByText('Qwen 2.5 (latest)')).toBeDefined();
    await user.type(screen.getByRole('searchbox'), 'qwen');
    await waitFor(() => expect(screen.queryByText('Gemini 2.5 Flash')).toBeNull());
    expect(screen.getByText('Qwen 2.5 (latest)')).toBeDefined();
    // clearing restores both sections
    await user.clear(screen.getByRole('searchbox'));
    await waitFor(() => expect(screen.getByText('Gemini 2.5 Flash')).toBeDefined());
  });

  it('filters by the thinking chip and shows only recorded reasoning models', async () => {
    const user = userEvent.setup();
    const thinkingModel = {
      ...googleModel,
      capabilities: {
        streaming: 'supported',
        structuredOutput: 'unknown',
        toolProposals: 'unknown',
        thinking: 'supported',
      } as const,
    };
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': [thinkingModel] });
    renderPage();
    expect(await screen.findByText('Qwen 2.5 (latest)')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /thinking/i }));
    // only a model that RECORDED thinking support survives the chip
    await waitFor(() => expect(screen.queryByText('Qwen 2.5 (latest)')).toBeNull());
    expect(screen.getByText('Gemini 2.5 Flash')).toBeDefined();
  });

  it('curates chat availability with the star toggle, persisted across reloads', async () => {
    const user = userEvent.setup();
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': [googleModel] });
    renderPage();
    const ollamaSection = (await screen.findByText('Qwen 2.5 (latest)')).closest(
      'section',
    ) as HTMLElement;
    const star = within(ollamaSection).getByRole('button', { name: /enabled in chat/i });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    await user.click(star);
    await waitFor(() => expect(star.getAttribute('aria-pressed')).toBe('false'));
    const prefs = JSON.parse(window.localStorage.getItem('adham.modelPrefs.v1') ?? '{}');
    expect(prefs['acc-ollama']['qwen2.5:latest']).toBe(false);

    // persisted: a fresh mount keeps the toggle off
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') return { data: accountsPayload() };
      if (cmd === 'list_provider_models') {
        const accountId = (args as { request: { payload: { accountId: string } } }).request.payload
          .accountId;
        return { data: { models: accountId === 'acc-google' ? [googleModel] : [ollamaModel] } };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
    renderPage();
    const ollamaSectionAgain = (await screen.findByText('Qwen 2.5 (latest)')).closest(
      'section',
    ) as HTMLElement;
    const starAgain = within(ollamaSectionAgain).getByRole('button', {
      name: /enabled in chat/i,
    });
    expect(starAgain.getAttribute('aria-pressed')).toBe('false');
    // explicit opt-in clears the stored opt-out (absence = enabled)
    await user.click(starAgain);
    await waitFor(() =>
      expect(window.localStorage.getItem('adham.modelPrefs.v1')).not.toContain('qwen'),
    );
  });

  it('Enable all and Disable all act on the whole provider section', async () => {
    const user = userEvent.setup();
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': [googleModel] });
    renderPage();
    await screen.findByText('Gemini 2.5 Flash');
    const googleSection = screen
      .getByRole('heading', { name: 'Google Gemini' })
      .closest('section') as HTMLElement;
    const googleSectionScoped = within(googleSection);
    await googleSectionScoped.findByRole('button', { name: /enabled in chat/i });
    await user.click(within(googleSection).getByRole('button', { name: /disable all/i }));
    await waitFor(() =>
      expect(
        within(googleSection)
          .getByRole('button', { name: /enabled in chat/i })
          .getAttribute('aria-pressed'),
      ).toBe('false'),
    );
    // undo path: Enable all turned active the moment disabling completed
    expect(
      within(googleSection)
        .getByRole('button', { name: /enable all/i })
        .hasAttribute('disabled'),
    ).toBe(false);
    await user.click(within(googleSection).getByRole('button', { name: /enable all/i }));
    await waitFor(() =>
      expect(
        within(googleSection)
          .getByRole('button', { name: /enabled in chat/i })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
  });

  it('folds long provider lists by default and unfolds on demand; filters unfold automatically', async () => {
    const user = userEvent.setup();
    const sixGoogle = Array.from({ length: 6 }, (_, i) => ({
      ...googleModel,
      modelId: `gemini-model-${i}`,
      humanLabel: `Gemini Model ${i}`,
    }));
    mockModels(invokeMock, { 'acc-ollama': [ollamaModel], 'acc-google': sixGoogle });
    renderPage();
    await screen.findByText('Qwen 2.5 (latest)');
    expect(screen.queryByText('Gemini Model 0')).toBeNull();
    // the section header still shows the real count while folded
    expect(screen.getByText('Google Gemini').closest('section')!.textContent).toContain('6');

    await user.click(screen.getByRole('button', { name: /google gemini/i }));
    await waitFor(() => expect(screen.getByText('Gemini Model 0')).toBeDefined());

    // searching while folded still surfaces matches
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: /google gemini/i })); // re-fold
    await user.type(screen.getByRole('searchbox'), 'gemini model 2');
    await waitFor(() => expect(screen.getByText('Gemini Model 2')).toBeDefined());
  });
});
