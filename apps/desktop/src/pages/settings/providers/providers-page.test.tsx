// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Channel, invoke } from '@tauri-apps/api/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import type { ProviderAccountDto } from '@adham/contracts-generated';
import i18n from '@/shared/i18n';
import { ThemeProvider } from '@/theme/theme-provider';
import { ProvidersPage } from './providers-page';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));

/// Page-level IPC contract: the provider cards drive the A5/A6 commands
/// through the shared client; each provider's connect/manage flows run inside
/// a dialog. Only reachability shape is faked.
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
    imageInput: 'unknown' as const,
    thinkingValues: null,
    thinkingDefault: null,
  },
  contextLimit: null,
  configuredContext: null,
  effectiveContextBudget: null,
  evidence: { source: '', serverVersion: null, observedAt: null },
});

const card = (name: string | RegExp) => screen.getByRole('region', { name });

type User = ReturnType<typeof userEvent.setup>;

/** Opens a provider's dialog from its card and returns the dialog (scoped queries). */
async function openProvider(name: string, user: User) {
  await user.click(within(card(name)).getByRole('button'));
  return screen.getByRole('dialog', { name });
}

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
      case 'disconnect_ollama_account': {
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

describe('ProvidersPage card status (connectivity truth)', () => {
  it('shows "Not connected" for anything without a saved account, and never auto-probes it', async () => {
    renderPage();
    expect(card('Ollama')).toBeDefined();
    expect(within(card('Ollama')).getByText(/not connected/i)).toBeDefined();
    expect(within(card('Google Gemini')).getByText(/not connected/i)).toBeDefined();
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'test_provider_connection'),
    ).toHaveLength(0);
  });

  it('re-probes a connected endpoint on open so a dead Ollama shows as an issue, not a stale Connected', async () => {
    accounts = [mintedAccount()];
    // The automatic probe runs by account id and finds the endpoint dead;
    // transient probes (empty accountId + explicit endpoint) stay reachable so
    // this test never depends on the shared URL-sniffing default.
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'test_provider_connection') {
        const payload = (
          args as { request: { payload: { accountId: string; endpointUrl: string } } }
        ).request.payload;
        if (payload.accountId !== '') {
          return { data: { reachable: false, modelTagCount: 0 } };
        }
        return { data: { reachable: !payload.endpointUrl.includes('99999'), modelTagCount: 2 } };
      }
      return { data: { accounts } };
    });
    renderPage();
    await waitFor(() => expect(within(card('Ollama')).getByText(/issue/i)).toBeDefined());
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account')).toHaveLength(
      0,
    );

    // The dialog opens on the failed auto-probe and reports it as the last check.
    const user = userEvent.setup();
    await openProvider('Ollama', user);
    await waitFor(() => expect(screen.getByText(/cannot reach ollama/i)).toBeDefined());
  });

  it('auto-probe success reads as Connected with the reachable check line seeded into the dialog', async () => {
    accounts = [mintedAccount()];
    renderPage();
    await waitFor(() => expect(within(card('Ollama')).getByText(/^Connected$/)).toBeDefined());
    const user = userEvent.setup();
    await openProvider('Ollama', user);
    await waitFor(() => expect(screen.getByText(/models available/i)).toBeDefined());
    const probeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'test_provider_connection');
    expect(probeCalls).toHaveLength(1);
    const probeCall = probeCalls[0];
    expect(probeCall).toBeDefined();
    expect(probeCall?.[1]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          payload: { accountId: 'acc-minted', endpointUrl: null },
        }),
      }),
    );
  });
});

describe('ProvidersPage Ollama wiring (Delivery A)', () => {
  it('tests an unsaved endpoint, saves only on reachability, then discovers models', async () => {
    const user = userEvent.setup();
    renderPage();
    const dlg = await openProvider('Ollama', user);
    const input = await within(dlg).findByLabelText(/host endpoint/i);
    await user.type(input, 'http://127.0.0.1:11434');

    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    const dlg = await openProvider('Ollama', user);
    const input = await within(dlg).findByLabelText(/host endpoint/i);
    await user.type(input, 'http://127.0.0.1:99999');

    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(within(dlg).getByText(/cannot reach ollama/i)).toBeDefined());

    const mintCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account');
    expect(mintCalls).toHaveLength(0);
    // the discovered-models step never runs against a host that failed the ping
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'discover_ollama_models')).toHaveLength(
      0,
    );
  });

  it('shows configured endpoint and recorded inventory on reopen; the automatic probe is the only fresh check', async () => {
    accounts = [mintedAccount()];
    renderPage();
    const user = userEvent.setup();
    const dlg = await openProvider('Ollama', user);
    expect(await within(dlg).findByText(/models available/i)).toBeDefined();
    expect((within(dlg).getByLabelText(/host endpoint/i) as HTMLInputElement).value).toBe(
      'http://127.0.0.1:11434',
    );
    // The auto status probe really runs (the Connected line is asserted, never guessed)
    await waitFor(() => expect(within(dlg).getByText(/models available/i)).toBeDefined());
    const checked = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'test_provider_connection' || cmd === 'discover_ollama_models',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.[0]).toBe('test_provider_connection');
    // and it never persists anything
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account')).toHaveLength(
      0,
    );
  });

  it('editing the endpoint invalidates prior results and never discovers against the old account (stale attribution regression)', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const dlg = await openProvider('Ollama', user);
    const input = (await within(dlg).findByLabelText(/host endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    // the auto probe made the saved endpoint's check current; edit now
    await waitFor(() => expect(within(dlg).getByText(/models available/i)).toBeDefined());
    const discoverCallsBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:11435');

    // old results disappear the moment the endpoint differs — nothing renders
    // for an endpoint no check ever ran against
    expect(within(dlg).queryByText(/models available/i)).toBeNull();
    expect(within(dlg).queryByText(/cannot reach/i)).toBeNull();
    // sync goes with them (it only works against the checked endpoint)
    expect(within(dlg).queryByRole('button', { name: /sync/i })).toBeNull();
    const discoverCallsAfter = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    expect(discoverCallsAfter).toBe(discoverCallsBefore);

    // reconnect probes the edited address transiently, saves onto the account,
    // then discovery runs against that updated identity
    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    const dlg = await openProvider('Ollama', user);
    const input = (await within(dlg).findByLabelText(/host endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:99999');
    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(within(dlg).getByText(/cannot reach/i)).toBeDefined());

    await user.clear(input);
    await user.type(input, 'http://127.0.0.1:11440');
    expect(within(dlg).queryByText(/cannot reach/i)).toBeNull();
    expect(within(dlg).queryByText(/cannot reach/i)).toBeNull();
  });

  it('renders a distinct probe-failure error when the request itself errors', async () => {
    const user = userEvent.setup();
    renderPage();
    const dlg = await openProvider('Ollama', user);
    const input = await within(dlg).findByLabelText(/host endpoint/i);
    await user.type(input, 'http://127.0.0.1:77777');
    const failing = invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'test_provider_connection') {
        throw new Error('connection refused');
      }
      return { data: { accounts: [] } };
    });
    void failing;

    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(within(dlg).getByText(/could not run the check/i)).toBeDefined());
    const mintCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'update_provider_account');
    expect(mintCalls).toHaveLength(0);
  });

  it('re-tests a saved endpoint by account id without minting again', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const dlg = await openProvider('Ollama', user);
    const input = (await within(dlg).findByLabelText(/host endpoint/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://127.0.0.1:11434'));

    await user.click(within(dlg).getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

  it('disconnects a saved Ollama account only after the two-step confirmation', async () => {
    const user = userEvent.setup();
    accounts = [mintedAccount()];
    renderPage();
    const dlg = await openProvider('Ollama', user);
    await user.click(within(dlg).getByRole('button', { name: /disconnect/i }));
    // confirming is still a no-op: the saved endpoint and its models must stay
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'disconnect_ollama_account'),
    ).toHaveLength(0);

    await user.click(within(dlg).getByRole('button', { name: /yes, disconnect/i }));
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === 'disconnect_ollama_account'),
      ).toHaveLength(1),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'disconnect_ollama_account',
      expect.objectContaining({
        request: expect.objectContaining({ payload: { accountId: 'acc-minted' } }),
      }),
    );
    // the account list refreshes so the card drops back to "Not connected"
    await waitFor(() => expect(within(card('Ollama')).getByText(/not connected/i)).toBeDefined());
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
    const dlg = await openProvider('Google Gemini', user);
    const keyInput = (await within(dlg).findByLabelText(/gemini api key/i)) as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    await user.type(keyInput, 'test-key-123');

    // Consent is the gate: the button stays disabled and nothing is sent.
    const connectBtn = within(dlg).getByRole('button', { name: /^Connect$/i });
    expect(connectBtn.hasAttribute('disabled')).toBe(true);
    await user.click(connectBtn);
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'configure_google_account'),
    ).toHaveLength(0);

    await user.click(within(dlg).getByLabelText(/processed by google/i));
    expect(
      within(dlg)
        .getByRole('button', { name: /^Connect$/i })
        .hasAttribute('disabled'),
    ).toBe(false);
    await user.click(within(dlg).getByRole('button', { name: /^Connect$/i }));

    await waitFor(() => expect(within(dlg).getByText(/stored securely/i)).toBeDefined());
    // Write-only: the connected state holds no key field at all.
    expect(within(dlg).queryByLabelText(/gemini api key/i)).toBeNull();
    // Rotating re-reveals an empty field — the sealed key is never shown back.
    await user.click(within(dlg).getByRole('button', { name: /change key/i }));
    expect((within(dlg).getByLabelText(/gemini api key/i) as HTMLInputElement).value).toBe('');
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

  it('never shows the fixed Google endpoint anywhere; the auto probe is the only fresh check', async () => {
    accounts = [googleAccount()];
    const user = userEvent.setup();
    renderPage();
    const dlg = await openProvider('Google Gemini', user);
    // The user cannot change this endpoint — showing it is clutter.
    expect(within(dlg).queryByText(/generativelanguage/i)).toBeNull();
    expect(within(dlg).queryByText(/endpoint/i)).toBeNull();
    // Exactly one fresh check runs: the automatic status probe.
    await waitFor(() => expect(within(dlg).getByText(/models available/i)).toBeDefined());
    const checked = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'test_provider_connection' || cmd === 'discover_ollama_models',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.[0]).toBe('test_provider_connection');
  });

  it('disconnects only after the two-step confirmation', async () => {
    const user = userEvent.setup();
    accounts = [googleAccount()];
    renderPage();
    const dlg = await openProvider('Google Gemini', user);
    await user.click(await within(dlg).findByRole('button', { name: /disconnect/i }));
    expect(within(dlg).getByText(/sealed key and its discovered models/i)).toBeDefined();
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'disconnect_google_account'),
    ).toHaveLength(0);

    await user.click(within(dlg).getByRole('button', { name: /yes, disconnect/i }));
    await waitFor(() =>
      expect(within(dlg).queryByText(/sealed key and its discovered models/i)).toBeNull(),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'disconnect_google_account',
      expect.objectContaining({
        request: expect.objectContaining({ payload: { accountId: 'acc-google' } }),
      }),
    );
  });

  it('syncs models only against the saved Google account by id', async () => {
    const user = userEvent.setup();
    accounts = [googleAccount()];
    renderPage();
    const dlg = await openProvider('Google Gemini', user);
    const discoverCallsBefore = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'discover_ollama_models',
    ).length;
    await user.click(await within(dlg).findByRole('button', { name: /sync/i }));
    await waitFor(() => {
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'discover_ollama_models').length).toBe(
        discoverCallsBefore + 1,
      );
    });
    expect(within(dlg).getByText(/models available/i)).toBeDefined();

    expect(invokeMock).toHaveBeenCalledWith(
      'discover_ollama_models',
      expect.objectContaining({
        request: expect.objectContaining({ payload: { accountId: 'acc-google' } }),
      }),
    );
  });
});
