import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from './conversation-panel';
import type { ConversationFakeBackend, StreamEventParam } from './conversation-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function fakeBackend(): ConversationFakeBackend {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createWorkspace: vi.fn(),
    createProject: vi.fn(),
    getStorageStatus: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello backend',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    }),
    listSessions: vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionId: 'sess-1',
          title: null,
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      truncated: false,
    }),
    recordPendingOperation: vi.fn().mockImplementation((ws, proj, payload, opts) =>
      Promise.resolve({
        operationId: payload.operationId,
        kind: payload.kind,
        workspaceId: ws,
        projectId: proj,
        sessionId: opts?.sessionId ?? null,
        createRequestId: payload.createRequestId ?? null,
        messageRequestId: payload.messageRequestId,
        text: payload.text,
        title: payload.title ?? null,
        status: 'pending',
        createdAt: '2026-10-09T00:00:00Z',
      }),
    ),
    listPendingOperations: vi.fn().mockResolvedValue({
      operations: [],
      truncated: false,
    }),
    clearPendingOperation: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ConversationPanel flows', () => {
  it('streams with the picked registry model; stop_completion cancels and reload keeps the partial', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    // Boot reads getConversation twice (session resolution + history load);
    // the turn's persisted rows land only on the post-terminal reload.
    const bootRows = {
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    };
    const persistedRows = {
      items: [
        bootRows.items[0]!,
        {
          messageId: 'msg-u',
          role: 'user',
          text: 'hi',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'evt-u',
        },
        {
          messageId: 'msg-a',
          role: 'assistant',
          text: 'partial answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a',
        },
      ],
      nextCursor: null,
      projectionPosition: '9',
    };
    backend.getConversation.mockReset();
    backend.getConversation
      .mockResolvedValueOnce(bootRows)
      .mockResolvedValueOnce(bootRows)
      .mockResolvedValue(persistedRows);
    let emit: StreamEventParam | null = null;
    const provider = {
      listAccounts: vi.fn(async () => ({
        accounts: [
          {
            accountId: 'acc-1',
            alias: 'Local Ollama',
            endpointUrl: 'http://127.0.0.1:11434',
            privacyClass: 'local_only',
            kind: 'ollama_local',
          },
        ],
      })),
      listModels: vi.fn(async () => ({
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
      })),
    };
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emit = onEvent;
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      return { opId: 'op-9', messageId: 'm-9' };
    });
    backend.stopCompletion = vi.fn(async () => {
      emit?.({
        opId: 'op-9',
        sequence: 4,
        event: { type: 'completed', completion: 'interrupted', truncated: false, usage: null },
      });
      return { opId: 'op-9', status: 'cancelled' };
    });
    render(
      <ConversationPanel
        backend={backend}
        provider={
          provider as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>
        }
      />,
    );
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    // Registry models render, but nothing is pre-selected: the trigger shows
    // the explicit placeholder and the unselected state claims no model.
    const trigger = await screen.findByRole('button', { name: 'Select a model' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /Qwen 2\.5 \(latest\)/i }));

    // The selection is now real: the model-gap disclaimer is gone and the
    // trigger shows the chosen registry model.
    expect(screen.queryByText(/model selection is not applied/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    ).toBeDefined();

    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    // Live stream: the partial renders exactly once — the streamed bubble is
    // the only rendering of it (no duplicated persisted row yet).
    await waitFor(() => expect(screen.getAllByText('partial answer')).toHaveLength(1));
    const stop = screen.getByRole('button', { name: /stop generation/i });
    // The streaming turn never re-runs the text-only submit path.
    expect(backend.submitMessage).not.toHaveBeenCalled();

    await user.click(stop);

    await waitFor(() =>
      expect(backend.stopCompletion).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'op-9'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stop generation/i })).toBeNull(),
    );
    // Handoff: the authoritative rows replace the live bubble — the persisted
    // partial still renders exactly once, and history is not duplicated.
    await waitFor(() => expect(screen.getAllByText('partial answer')).toHaveLength(1));
    expect(screen.getAllByText('earlier truth')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeDefined());
  });

  it('composer offers only the models still enabled in chat (settings curation)', async () => {
    // absence = enabled: a fresh connection's picker lists its models
    const provider = {
      listAccounts: vi.fn(async () => ({
        accounts: [
          {
            accountId: 'acc-1',
            alias: 'Local Ollama',
            endpointUrl: 'http://127.0.0.1:11434',
            privacyClass: 'local_only',
            kind: 'ollama_local',
          },
        ],
      })),
      listModels: vi.fn(async () => ({
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
      })),
    } as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;
    render(<ConversationPanel backend={fakeBackend()} provider={provider} />);
    expect(await screen.findByRole('button', { name: 'Select a model' })).toBeDefined();

    // after disabling it on the models page, the picker has nothing to offer
    // and is hidden entirely (the composer never falls back to a default).
    cleanup();
    localStorage.setItem(
      'adham.modelPrefs.v1',
      JSON.stringify({ 'acc-1': { 'qwen2.5:latest': false } }),
    );
    render(<ConversationPanel backend={fakeBackend()} provider={provider} />);
    await screen.findByRole('textbox', { name: /composer input/i });
    expect(screen.queryByRole('button', { name: 'Select a model' })).toBeNull();
  });

  it('keeps the answer as a recovery snapshot on a failed terminal reload; the retry replaces it without rerunning the dispatch', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const bootRows = {
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    };
    const persistedRows = {
      items: [
        bootRows.items[0]!,
        {
          messageId: 'msg-u',
          role: 'user',
          text: 'hi',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'evt-u',
        },
        {
          messageId: 'msg-a',
          role: 'assistant',
          text: 'partial answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a',
        },
      ],
      nextCursor: null,
      projectionPosition: '9',
    };
    backend.getConversation.mockReset();
    backend.getConversation
      .mockResolvedValueOnce(bootRows)
      .mockResolvedValueOnce(bootRows)
      .mockRejectedValueOnce(new Error('history read failed'))
      .mockResolvedValue(persistedRows);
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      onEvent({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'm-9' };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    const provider = {
      listAccounts: vi.fn(async () => ({
        accounts: [
          {
            accountId: 'acc-1',
            alias: 'Local Ollama',
            endpointUrl: 'http://127.0.0.1:11434',
            privacyClass: 'local_only',
            kind: 'ollama_local',
          },
        ],
      })),
      listModels: vi.fn(async () => ({
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
      })),
    };
    render(
      <ConversationPanel
        backend={backend}
        provider={
          provider as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>
        }
      />,
    );
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    const trigger = await screen.findByRole('button', { name: 'Select a model' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /Qwen 2\.5 \(latest\)/i }));

    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getAllByText('partial answer')).toHaveLength(1));

    // The sync failure is surfaced as a retryable error; the answer remains
    // visible exactly once (the snapshot), and no second generation ran.
    expect(screen.getByText(/history read failed/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /reload history/i })).toBeDefined();
    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    expect(backend.submitMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /reload history/i }));

    // Authoritative rows replace the snapshot atomically: still exactly one
    // rendering of the answer, plus unduplicated history.
    await waitFor(() => expect(screen.getAllByText('partial answer')).toHaveLength(1));
    expect(screen.getAllByText('earlier truth')).toHaveLength(1);
    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/history read failed/i)).toBeNull());
  });
});
