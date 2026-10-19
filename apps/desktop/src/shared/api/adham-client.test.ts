import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import ipcBasicSendFixture from '../../../fixtures/ipc-basic-send.json';
import { AdhamApiClient } from './adham-client';
import { queryKeys } from './query-keys';
import {
  BootstrapStateSchema,
  ConversationPageSchema,
  ErrorEnvelopeSchema,
  StreamEventDtoSchema,
  StreamEventPayloadDtoSchema,
  SubmittedMessageSchema,
} from './schemas';

const channelSinks: Array<(raw: unknown) => void> = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    __id = String(globalThis.Math.random());
    constructor(cb: (raw: unknown) => void) {
      channelSinks.push(cb);
    }
  },
}));

describe('P0-04 IPC Schemas & Query Keys', () => {
  it('validates canonical query keys structure', () => {
    expect(queryKeys.bootstrap).toEqual(['bootstrap']);
    expect(queryKeys.storageStatus).toEqual(['storage-status']);
    expect(queryKeys.workspace('ws-123')).toEqual(['workspace', 'ws-123']);
    expect(queryKeys.projects('ws-123')).toEqual(['projects', 'ws-123']);
    expect(queryKeys.conversation('ws-1', 'proj-1', 'sess-1')).toEqual([
      'conversation',
      'ws-1',
      'proj-1',
      'sess-1',
    ]);
  });

  it('validates BootstrapStateSchema with valid and null states', () => {
    const uninit = BootstrapStateSchema.parse({
      isInitialized: false,
      activeWorkspaceId: null,
      activeProjectId: null,
    });
    expect(uninit.isInitialized).toBe(false);

    const init = BootstrapStateSchema.parse({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    });
    expect(init.isInitialized).toBe(true);
    expect(init.activeWorkspaceId).toBe('ws-1');
  });

  it('validates SubmittedMessageSchema', () => {
    const msg = SubmittedMessageSchema.parse({
      messageId: '01925b68-0000-7000-8000-000000000001',
      sessionId: '01925b68-0000-7000-8000-000000000002',
      text: 'Hello Adham',
      createdAt: '2026-10-07T00:00:00Z',
      streamSequence: '1',
      projectionPosition: '1',
    });
    expect(msg.text).toBe('Hello Adham');
  });

  it('validates ConversationPageSchema with messages', () => {
    const page = ConversationPageSchema.parse({
      items: [
        {
          messageId: '01925b68-0000-7000-8000-000000000001',
          role: 'user',
          text: 'Hello Adham',
          createdAt: '2026-10-07T00:00:00Z',
          sourceEventId: '01925b68-0000-7000-8000-000000000003',
          completion: null,
          reference: null,
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
      branchSelections: [],
      feedback: [],
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.role).toBe('user');
  });

  it('validates ErrorEnvelopeSchema', () => {
    const err = ErrorEnvelopeSchema.parse({
      protocolVersion: 1,
      code: 'VALIDATION_FAILED',
      messageKey: 'error.validationFailed',
      retryable: false,
      correlationId: '01925b68-0000-7000-8000-000000000004',
      fieldErrors: [],
    });
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('rejects malformed payloads with ZodError', () => {
    expect(() =>
      BootstrapStateSchema.parse({
        isInitialized: 'not-a-bool',
      }),
    ).toThrow();
  });
});

describe('AdhamApiClient request identity', () => {
  const submitted = {
    messageId: 'msg-1',
    sessionId: 'sess-1',
    text: 'hi',
    createdAt: '2026-10-09T00:00:00Z',
    streamSequence: '1',
    projectionPosition: '1',
  };

  it('reuses the caller-supplied request id for submitMessage', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ data: submitted });
    const client = new AdhamApiClient();
    await client.submitMessage(
      'ws-1',
      'proj-1',
      'sess-1',
      { text: 'hi' },
      {
        requestId: 'req-keep-me',
      },
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'submit_message',
      expect.objectContaining({
        request: expect.objectContaining({ requestId: 'req-keep-me' }),
      }),
    );
  });

  it('generates a fresh request id when the caller supplies none', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ data: submitted });
    const client = new AdhamApiClient();
    await client.submitMessage('ws-1', 'proj-1', 'sess-1', { text: 'hi' });
    const sent = vi.mocked(invoke).mock.calls[0]?.[1] as {
      request: { requestId: string };
    };
    expect(sent.request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('reuses the caller-supplied request id for createSession', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      data: {
        sessionId: 'sess-9',
        projectId: 'proj-1',
        title: null,
        createdAt: '2026-10-09T00:00:00Z',
      },
    });
    const client = new AdhamApiClient();
    await client.createSession(
      'ws-1',
      'proj-1',
      { title: null },
      {
        requestId: 'req-create-keep',
      },
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'create_session',
      expect.objectContaining({
        request: expect.objectContaining({ requestId: 'req-create-keep' }),
      }),
    );
  });

  it('validates getPlatformInfo returns schema-parsed platform metadata', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      os: 'macos',
      arch: 'aarch64',
      hasNativeTitlebarControls: true,
      appVersion: '0.1.0',
      buildProfile: 'debug',
    });
    const client = new AdhamApiClient();
    const info = await client.getPlatformInfo();
    expect(info.os).toBe('macos');
    expect(info.arch).toBe('aarch64');
    expect(info.hasNativeTitlebarControls).toBe(true);
    expect(info.appVersion).toBe('0.1.0');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_platform_info');
  });
});

describe('IPC contract fixture (cross-language)', () => {
  it('serializes the provisioning → session → send → read-back chain exactly like the Rust replay fixture', async () => {
    // The Rust side (apps/desktop/src-tauri/src/ipc_contract_tests.rs) replays
    // this same fixture through the real `tauri::generate_handler!` dispatch.
    // This test pins the request side: commands, argument keys, envelope
    // casing, and payload field names must match byte-for-byte.
    const calls = ipcBasicSendFixture.calls;

    const workspace = {
      workspaceId: '01925b68-3000-7000-8000-000000000001',
      name: 'Canary Workspace',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-15T00:00:00Z',
    };
    const project = {
      projectId: '01925b68-3000-7000-8000-000000000002',
      workspaceId: workspace.workspaceId,
      name: 'Canary Project',
      storageKind: 'isolated',
      createdAt: '2026-10-15T00:00:01Z',
    };
    const session = {
      sessionId: '01925b68-3000-7000-8000-000000000003',
      projectId: project.projectId,
      title: null,
      createdAt: '2026-10-15T00:00:02Z',
    };
    const submitted = {
      messageId: '01925b68-4000-7000-8000-000000000001',
      sessionId: session.sessionId,
      text: 'Canary first message',
      createdAt: '2026-10-15T00:00:03Z',
      streamSequence: '1',
      projectionPosition: '1',
    };
    const page = {
      items: [
        {
          messageId: submitted.messageId,
          role: 'user',
          text: submitted.text,
          createdAt: submitted.createdAt,
          sourceEventId: '01925b68-4000-7000-8000-000000000002',
          completion: null,
          reference: null,
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
      branchSelections: [],
      feedback: [],
    };

    vi.mocked(invoke).mockClear();
    vi.mocked(invoke)
      .mockResolvedValueOnce({ data: workspace })
      .mockResolvedValueOnce({ data: project })
      .mockResolvedValueOnce({ data: session })
      .mockResolvedValueOnce({ data: submitted })
      .mockResolvedValueOnce(page);

    const client = new AdhamApiClient();
    const ws = await client.createWorkspace(
      {
        name: workspace.name,
        kind: workspace.kind,
        preferredLanguage: workspace.preferredLanguage,
      },
      { requestId: '01925b68-2000-7000-8000-000000000001' },
    );
    const proj = await client.createProject(
      ws.workspaceId,
      { name: project.name, storageKind: project.storageKind },
      { requestId: '01925b68-2000-7000-8000-000000000002' },
    );
    const sess = await client.createSession(
      ws.workspaceId,
      proj.projectId,
      { title: null },
      { requestId: '01925b68-2000-7000-8000-000000000003' },
    );
    await client.submitMessage(
      ws.workspaceId,
      proj.projectId,
      sess.sessionId,
      { text: submitted.text },
      { requestId: '01925b68-2000-7000-8000-000000000004' },
    );
    await client.getConversation(ws.workspaceId, proj.projectId, sess.sessionId);

    expect(vi.mocked(invoke).mock.calls).toEqual(calls.map((call) => [call.cmd, call.args]));
  });

  it('validates A5 streaming event schemas', () => {
    expect(
      StreamEventDtoSchema.parse({ opId: 'op-1', sequence: 1, event: { type: 'started' } })
        .sequence,
    ).toBe(1);
    expect(
      StreamEventDtoSchema.parse({
        opId: 'op-1',
        sequence: 2,
        event: { type: 'delta', text: 'hi' },
      }).event.type,
    ).toBe('delta');
    // Reasoning activity marker from thinking-capable models: payload-free.
    expect(
      StreamEventDtoSchema.parse({
        opId: 'op-1',
        sequence: 3,
        event: { type: 'thinking' },
      }).event.type,
    ).toBe('thinking');
    const terminal = StreamEventDtoSchema.parse({
      opId: 'op-1',
      sequence: 3,
      event: {
        type: 'completed',
        completion: 'completed',
        truncated: false,
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
    });
    expect(terminal.event.type).toBe('completed');
    expect(
      StreamEventDtoSchema.safeParse({ opId: 'op-1', sequence: 0, event: { type: 'bogus' } })
        .success,
    ).toBe(false);
    expect(
      StreamEventPayloadDtoSchema.safeParse({
        type: 'completed',
        completion: 'exploded',
        truncated: false,
        usage: null,
      }).success,
    ).toBe(false);
  });

  it('dispatches A5 provider commands with canonical envelopes and validates responses', async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'test_provider_connection') {
        return { data: { reachable: true, modelTagCount: 2 } };
      }
      if (cmd === 'stop_completion') {
        return { data: { opId: 'op-1', status: 'cancelled' } };
      }
      if (cmd === 'discover_ollama_models') {
        return {
          data: {
            models: [
              {
                modelId: 'm:latest',
                digest: 'sha256:abc',
                humanLabel: 'm:latest',
                privacyClass: 'local_only',
                kind: 'ollama_local',
                capabilities: {
                  streaming: 'supported',
                  structuredOutput: 'unknown',
                  toolProposals: 'supported',
                  thinking: 'supported',
                  imageInput: 'supported',
                  thinkingValues: ['true', 'false', 'high'],
                  thinkingDefault: 'true',
                },
                contextLimit: 131072,
                configuredContext: 8192,
                effectiveContextBudget: 8192,
                evidence: {
                  source: 'ollama /api/show',
                  serverVersion: '0.12.3',
                  observedAt: '2026-10-17T00:00:00Z',
                },
              },
            ],
          },
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });

    const client = new AdhamApiClient();
    const health = await client.testProviderConnection('acc-1', {
      workspaceId: 'ws',
      projectId: 'proj',
      sessionId: 'sess',
    });
    expect(health.reachable).toBe(true);
    const models = await client.discoverOllamaModels('acc-1', {
      workspaceId: 'ws',
      projectId: 'proj',
      sessionId: 'sess',
    });
    expect(models.models[0]?.capabilities.streaming).toBe('supported');
    expect(models.models[0]?.capabilities.thinkingValues).toEqual(['true', 'false', 'high']);
    expect(models.models[0]?.capabilities.thinkingDefault).toBe('true');
    expect(models.models[0]?.effectiveContextBudget).toBe(8192);
    expect(models.models[0]?.evidence.serverVersion).toBe('0.12.3');
    const stop = await client.stopCompletion('ws', 'proj', 'sess', 'op-1');
    expect(stop.status).toBe('cancelled');

    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const envelope = (calls[0]![1] as { request: Record<string, unknown> }).request;
    expect(envelope.protocolVersion).toBe(1);
    expect(envelope.context).toEqual({ workspaceId: 'ws', projectId: 'proj', sessionId: 'sess' });
    expect((envelope.payload as { accountId: string }).accountId).toBe('acc-1');

    // account minting: null id + alias + endpoint goes to a fresh account row
    vi.mocked(invoke).mockImplementationOnce(async () => ({
      data: {
        accountId: 'acc-new',
        alias: 'A',
        endpointUrl: 'http://127.0.0.1:1',
        privacyClass: 'local_only',
        kind: 'ollama_local',
      },
    }));
    const minted = await client.updateProviderAccount(
      { accountId: null, alias: 'A', endpointUrl: 'http://127.0.0.1:1' },
      {},
    );
    expect(minted.accountId).toBe('acc-new');
    const mintedCall = vi.mocked(invoke).mock.calls.at(-1)?.[1] as {
      request: { context: { workspaceId: string | null } };
    };
    expect(mintedCall.request.context.workspaceId).toBeNull();
  });

  it('streams through the tauri channel with schema validation', async () => {
    vi.mocked(invoke).mockReset();
    const sinkRef = vi.fn();
    const payloads: Array<Record<string, unknown>> = [];
    channelSinks.length = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      expect(cmd).toBe('complete_once_streaming');
      payloads.push((args as { request: { payload: Record<string, unknown> } }).request.payload);
      // backend fans events into the registered channel sink
      channelSinks[0]?.({ opId: 'op-1', sequence: 1, event: { type: 'started' } });
      channelSinks[0]?.({ opId: 'op-1', sequence: 2, event: { type: 'delta', text: 'hello' } });
      return { data: { opId: 'op-1', messageId: 'm-1', context: null } };
    });

    const client = new AdhamApiClient();
    const received: Array<{ sequence: number; event: { type: string } }> = [];
    const start = await client.completeOnceStreaming(
      'ws',
      'proj',
      'sess',
      { accountId: 'acc', modelId: 'm:latest', text: 'q', mode: 'plan' },
      (event) => received.push(event as unknown as { sequence: number; event: { type: string } }),
    );
    expect(start.opId).toBe('op-1');
    expect(payloads[0]?.mode).toBe('plan');
    expect(received.map((r) => r.sequence)).toEqual([1, 2]);
    expect(received[1]?.event.type).toBe('delta');
    expect(sinkRef).not.toHaveBeenCalled();
  });

  it('lists saved provider accounts and probes unsaved endpoint URLs', async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'list_provider_accounts') {
        return {
          data: {
            accounts: [
              {
                accountId: 'acc-1',
                alias: 'Local',
                endpointUrl: 'http://127.0.0.1:11434',
                privacyClass: 'local_only',
                kind: 'ollama_local',
              },
            ],
          },
        };
      }
      expect(cmd).toBe('test_provider_connection');
      const req = (args as { request: { payload: { accountId: string; endpointUrl: string } } })
        .request;
      expect(req.payload.accountId).toBe('');
      expect(req.payload.endpointUrl).toBe('http://127.0.0.1:11434');
      return { data: { reachable: false, modelTagCount: 0 } };
    });

    const client = new AdhamApiClient();
    const listed = await client.listProviderAccounts();
    expect(listed.accounts[0]?.accountId).toBe('acc-1');
    const probe = await client.testProviderConnection('', undefined, {
      endpointUrl: 'http://127.0.0.1:11434',
    });
    expect(probe.reachable).toBe(false);
  });
});
