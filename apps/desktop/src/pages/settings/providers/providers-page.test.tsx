// @vitest-environment jsdom
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, Channel } from '@tauri-apps/api/core';
import '@/shared/i18n';
import i18n from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import type { ProviderAccountDto } from '@adham/contracts-generated';
import { ProvidersPage } from './providers-page';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));

/// Page-level IPC contract: settings providers surface drives the A5/A6
/// commands through the shared client. Only reachability shape is faked.
const invokeMock = vi.mocked(invoke);
let accounts: ProviderAccountDto[];

const mintedAccount = (): ProviderAccountDto => ({
  accountId: 'acc-minted',
  alias: 'Local Ollama',
  endpointUrl: 'http://127.0.0.1:11434',
  privacyClass: 'local_only',
  kind: 'ollama_local',
});

const modelDto = () => ({
  modelId: 'qwen2.5:latest',
  digest: 'sha256:abc',
  humanLabel: 'Qwen 2.5 (latest)',
  privacyClass: 'local_only',
  kind: 'ollama_local',
  capabilities: {
    streaming: 'supported' as const,
    structuredOutput: 'unknown' as const,
    toolProposals: 'unknown' as const,
    thinking: 'unknown' as const,
  },
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ProvidersPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  accounts = [];
  invokeMock.mockReset();
  vi.mocked(Channel).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (() => ({})) as any,
  );
  invokeMock.mockImplementation(async (cmd, args) => {
    switch (cmd) {
      case 'list_provider_accounts':
        return { data: { accounts } };
      case 'test_provider_connection': {
        const payload = (
          args as { request: { payload: { accountId: string; endpointUrl: string } } }
        ).request.payload;
        const url = payload.endpointUrl ?? 'http://127.0.0.1:11434';
        return { data: { reachable: !url.includes('99999'), modelTagCount: 2 } };
      }
      case 'update_provider_account': {
        const payload = (
          args as {
            request: { payload: { accountId: string | null; endpointUrl: string | null } };
          }
        ).request.payload;
        const account: ProviderAccountDto = {
          ...mintedAccount(),
          endpointUrl: payload.endpointUrl ?? 'http://127.0.0.1:11434',
        };
        accounts = [account];
        return { data: account };
      }
      case 'discover_ollama_models':
        return { data: { models: [modelDto()] } };
      case 'list_provider_models':
        return { data: { models: [modelDto()] } };
      case 'configure_google_account': {
        const payload = (
          args as {
            request: {
              payload: {
                accountId: string | null;
                alias: string | null;
                apiKey: string;
                acknowledgeCloudTransfer: boolean;
              };
            };
          }
        ).request.payload;
        if (!payload.acknowledgeCloudTransfer) {
          return { error: { code: 'validation_failed' } };
        }
        const account: ProviderAccountDto = {
          accountId: 'acc-google',
          alias: 'Google Gemini',
          endpointUrl: 'https://generativelanguage.googleapis.com',
          privacyClass: 'cloud_standard',
          kind: 'google_gemini',
        };
        accounts = [...accounts.filter((a) => a.kind !== 'google_gemini'), account];
        return { data: account };
      }
      case 'disconnect_google_account': {
        const payload = (args as { request: { payload: { accountId: string } } }).request.payload;
        accounts = accounts.filter((a) => a.accountId !== payload.accountId);
        return { data: { accountId: payload.accountId } };
      }
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
  vi.mocked(Channel).mockReset();
});

describe('ProvidersPage Ollama wiring (Delivery A)', () => {
  it('tests an unsaved endpoint, saves only on reachability, then discovers models', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/ollama endpoint/i);
    await user.type(input, 'http://127.0.0.1:11434');

    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/models recorded from/i)).toBeDefined());
    expect(invokeMock).toHaveBeenCalledWith(
      'test_provider_connection',
      expect.objectContaining({
        request: expect.objectContaining({
          context: expect.objectContaining({ workspaceId: null }),
          payload: { accountId: '', endpointUrl: 'http://127.0.0.1:11434' },
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'update_provider_account',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: {
            accountId: null,
            alias: 'Local Ollama',
            endpointUrl: 'http://127.0.0.1:11434',
          },
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'discover_ollama_models',
      expect.objectContaining({
        request: expect.objectContaining({
          context: expect.objectContaining({ sessionId: null }),
          payload: { accountId: 'acc-minted' },
        }),
      }),
    );
  });

  it('saves nothing when the connection test fails', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/ollama endpoint/i);
    await user.type(input, 'http://127.0.0.1:99999');

    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/i)).toBeDefined());

    const mintCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account');
    expect(mintCalls).toHaveLength(0);
    expect(screen.getByRole('button', { name: /discover models/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows configured endpoint and recorded inventory on reopen without any check', async () => {
    accounts = [mintedAccount()];
    renderPage();
    expect(await screen.findByText(/models recorded from/i)).toBeDefined();
    expect(screen.getByText(/configured/i)).toBeDefined();
    // a registry read restores state; it must never print as a fresh health check
    expect(screen.queryByText(/reachable/i)).toBeNull();
    expect(screen.getByText(/no check result recorded for/i)).toBeDefined();
    const checked = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'test_provider_connection' || cmd === 'discover_ollama_models',
    );
    expect(checked).toHaveLength(0);
  });

  it('editing the endpoint invalidates prior results and never discovers against the old account (stale attribution regression)', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const input = (await screen.findByLabelText(/ollama endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    // make the saved endpoint's check + discovery current, then edit
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/models recorded from/i)).toBeDefined());
    const discoverCallsBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:11435');

    // old results disappear the moment the endpoint differs
    expect(screen.queryByText(/reachable/i)).toBeNull();
    expect(screen.getByText(/no check result recorded for/i)).toBeDefined();
    // the recorded inventory is still attributed to the endpoint it came from
    expect(screen.getByText(/recorded from http:\/\/127\.0\.0\.1:11434/i)).toBeDefined();
    expect(screen.getByText(/belong to http:\/\/127\.0\.0\.1:11434/i)).toBeDefined();

    // Discover stays locked until the edited endpoint is saved
    const discoverBtn = screen.getByRole('button', { name: /discover models/i });
    expect(discoverBtn.hasAttribute('disabled')).toBe(true);
    await user.click(discoverBtn);
    const discoverCallsAfter = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    expect(discoverCallsAfter).toBe(discoverCallsBefore);

    // re-test probes the edited address transiently, saves onto the account,
    // then discovery runs against that updated identity
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() =>
      expect(screen.getByText(/recorded from http:\/\/127\.0\.0\.1:11435/i)).toBeDefined(),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'test_provider_connection',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: { accountId: '', endpointUrl: 'http://127.0.0.1:11435' },
        }),
      }),
    );
  });

  it('a failed last check under the old endpoint never shows as the edited endpoint status', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const input = (await screen.findByLabelText(/ollama endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:99999');
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/no response from/i)).toBeDefined());

    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:11440');
    expect(screen.queryByText(/no response from/i)).toBeNull();
    expect(screen.getByText(/no check result recorded for/i)).toBeDefined();
  });

  it('renders a distinct probe-failure error when the request itself errors', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/ollama endpoint/i);
    await user.type(input, 'http://127.0.0.1:77777');
    const failing = invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'test_provider_connection') {
        throw new Error('connection refused');
      }
      return { data: { accounts: [] } };
    });
    void failing;

    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/could not run the check/i)).toBeDefined());
    const mintCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account');
    expect(mintCalls).toHaveLength(0);
  });

  it('re-tests a saved endpoint by account id without minting again', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const input = (await screen.findByLabelText(/ollama endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    await user.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText(/models recorded from/i)).toBeDefined());
    expect(invokeMock).toHaveBeenCalledWith(
      'test_provider_connection',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: { accountId: 'acc-minted', endpointUrl: null },
        }),
      }),
    );
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account')).toHaveLength(
      0,
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'discover_ollama_models',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: { accountId: 'acc-minted' },
        }),
      }),
    );
  });
});

describe('ProvidersPage Google wiring (Delivery G)', () => {
  const googleAccount = (): ProviderAccountDto => ({
    accountId: 'acc-google',
    alias: 'Google Gemini',
    endpointUrl: 'https://generativelanguage.googleapis.com',
    privacyClass: 'cloud_standard',
    kind: 'google_gemini',
  });
  it('connects only with explicit consent and clears the key draft after submit', async () => {
    const user = userEvent.setup();
    renderPage();
    const keyInput = (await screen.findByLabelText(/gemini api key/i)) as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    await user.type(keyInput, 'test-key-123');

    // Consent is the gate: the button stays disabled and nothing is sent.
    const connectBtn = screen.getByRole('button', { name: /^Connect$/i });
    expect(connectBtn.hasAttribute('disabled')).toBe(true);
    await user.click(connectBtn);
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'configure_google_account'),
    ).toHaveLength(0);

    await user.click(screen.getByLabelText(/processed by google/i));
    expect(screen.getByRole('button', { name: /^Connect$/i }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: /^Connect$/i }));

    await waitFor(() => expect(screen.getByText(/connected as google gemini/i)).toBeDefined());
    // Write-only: the key never lingers in the draft once submitted.
    expect((screen.getByLabelText(/gemini api key/i) as HTMLInputElement).value).toBe('');
    expect(invokeMock).toHaveBeenCalledWith(
      'configure_google_account',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: {
            accountId: null,
            alias: null,
            apiKey: 'test-key-123',
            acknowledgeCloudTransfer: true,
          },
        }),
      }),
    );
  });

  it('shows the official endpoint as read-only display text and never as an input', async () => {
    accounts = [googleAccount()];
    renderPage();
    expect(await screen.findByText(/https:\/\/generativelanguage\.googleapis\.com/)).toBeDefined();
    // The fixed endpoint is display-only: no input control carries it.
    expect(screen.queryByDisplayValue(/generativelanguage/i)).toBeNull();
    // A registry read restores state; it must not fake a fresh health check.
    const checked = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'test_provider_connection' || cmd === 'discover_ollama_models',
    );
    expect(checked).toHaveLength(0);
  });

  it('disconnects only after the two-step confirmation', async () => {
    const user = userEvent.setup();
    accounts = [googleAccount()];
    const card = () => screen.getByRole('region', { name: /google gemini/i });
    renderPage();
    await user.click(await within(await card()).findByRole('button', { name: /disconnect/i }));
    expect(within(card()).getByText(/removed together/i)).toBeDefined();
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'disconnect_google_account'),
    ).toHaveLength(0);

    await user.click(within(card()).getByRole('button', { name: /yes, disconnect/i }));
    await waitFor(() => expect(screen.queryByText(/connected as google gemini/i)).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith(
      'disconnect_google_account',
      expect.objectContaining({
        request: expect.objectContaining({ payload: { accountId: 'acc-google' } }),
      }),
    );
  });

  it('tests and discovers against the saved Google account by id', async () => {
    const user = userEvent.setup();
    accounts = [googleAccount()];
    const card = () => screen.getByRole('region', { name: /google gemini/i });
    renderPage();
    await user.click(await within(await card()).findByRole('button', { name: /test google connection/i }));
    await waitFor(() => expect(screen.getByText(/last check .*reachable/i)).toBeDefined());
    expect(invokeMock).toHaveBeenCalledWith(
      'test_provider_connection',
      expect.objectContaining({
        request: expect.objectContaining({
          payload: { accountId: 'acc-google', endpointUrl: null },
        }),
      }),
    );

    const discoverCallsBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    await user.click(within(card()).getByRole('button', { name: /discover google models/i }));
    await waitFor(() => expect(screen.getByText(/discovered [0-9]+ models at/i)).toBeDefined());
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'discover_ollama_models').length).toBe(
      discoverCallsBefore + 1,
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'discover_ollama_models',
      expect.objectContaining({
        request: expect.objectContaining({ payload: { accountId: 'acc-google' } }),
      }),
    );
  });
});
