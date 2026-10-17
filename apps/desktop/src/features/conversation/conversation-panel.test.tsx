import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CompletionStartDto } from '@adham/contracts-generated';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { ConversationSetupSlot, type ConversationSetupSlotProps } from './conversation-setup-slot';
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
    markCompletionInterrupted: vi.fn().mockResolvedValue({ status: 'interrupted' }),
  };
}

type PanelProvider = NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;

/** Provider registry double with one pinned local model, mirroring Delivery A. */
function registryProvider(): PanelProvider {
  return {
    listAccounts: vi.fn(async () => ({
      accounts: [
        {
          accountId: 'acc-1',
          alias: 'Local Ollama',
          endpointUrl: 'http://127.0.0.1:11434',
          privacyClass: 'local_only',
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
          capabilities: {
            streaming: 'supported',
            structuredOutput: 'unknown',
            toolProposals: 'unknown',
            thinking: 'unknown',
          },
        },
      ],
    })),
  } as unknown as PanelProvider;
}

async function pickRegistryModel(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', { name: 'Select a model' });
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: /Qwen 2\.5 \(latest\)/i }));
}

describe('ConversationPanel', () => {
  it('shows backend history without any simulated agent text', async () => {
    render(<ConversationPanel backend={fakeBackend()} />);

    await waitFor(() => expect(screen.getByText('earlier truth')).toBeDefined());
    expect(screen.queryByText(/Analyzing prompt/i)).toBeNull();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('renders no unknown-telemetry dashboard and discloses the model gap in production', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    // no evidence → no context strip at all, and no invented numbers
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.getByText(/model selection is not applied/i)).toBeDefined();
    expect(screen.queryByText(/12\.4k \/ 128k/)).toBeNull();
    expect(screen.queryByText(/adham\.si/)).toBeNull();
  });

  it('submits text and shows the backend-issued message while clearing the draft', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });

    await user.type(box, 'hello backend');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('hello backend')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('retains the draft and reports truthfully when submission fails', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());
    expect(box.value).toBe('unsaved words');
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /reload history/i })).toBeDefined();
  });

  it('surfaces a pre-dispatch refusal instead of a silent no-op', async () => {
    const user = userEvent.setup();
    // A leftover first-send record for this scope makes submit return a
    // refusal BEFORE any dispatch or conv.error write.
    sessionStorage.setItem(
      'adham:compose:pending-first-send',
      JSON.stringify({
        createRequestId: 'req-create-1',
        messageRequestId: 'req-message-1',
        text: 'an earlier first message',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        sessionId: null,
      }),
    );
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    render(<ConversationPanel backend={backend} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    await user.type(box, 'new text while a first send is unresolved');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText(/previous first-message save is pending/i)).toBeDefined(),
    );
    expect(box.value).toBe('new text while a first send is unresolved');
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('disables execute mode with the runtime explanation instead of offering a turn', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    // No policy/tool runtime exists to execute under: the entry is present
    // for discoverability, explains itself, and refuses activation.
    const trigger = screen.getByRole('button', { name: /execution mode/i });
    const before = trigger.getAttribute('aria-label');
    await user.click(trigger);
    const execute = screen.getByRole('option', { name: /execute/i });
    expect(execute.getAttribute('aria-disabled')).toBe('true');
    expect(execute.textContent).toMatch(/policy and tool runtime/i);
    await user.click(execute);
    expect(trigger.getAttribute('aria-label')).toBe(before);
    expect(window.localStorage.getItem('adham:compose:mode')).toBeNull();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('dispatches the selected mode with the turn and remembers it', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<{ mode?: string }> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as { mode?: string });
      onEvent({ opId: 'op-m', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-m',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-m', messageId: 'm-m', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-m', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.click(screen.getByRole('button', { name: /execution mode/i }));
    await user.click(screen.getByRole('option', { name: /ask/i }));
    await user.type(box, 'a question');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.mode).toBe('ask');
    expect(window.localStorage.getItem('adham:compose:mode')).toBe('ask');
  });

  it('restores the last used mode and never restores execute', async () => {
    window.localStorage.setItem('adham:compose:mode', 'execute');
    render(<ConversationPanel backend={fakeBackend()} />);
    await screen.findByRole('textbox', { name: /composer input/i });
    // A stored execute is stale: it is not selectable, so the first-run
    // default applies instead of resurrecting an unavailable mode.
    expect(
      screen.getByRole('button', { name: /execution mode/i }).getAttribute('aria-label'),
    ).toMatch(/plan/i);

    window.localStorage.setItem('adham:compose:mode', 'code');
    render(<ConversationPanel backend={fakeBackend()} />);
    const triggers = await screen.findAllByRole('button', { name: /execution mode/i });
    expect(triggers.at(-1)!.getAttribute('aria-label')).toMatch(/code/i);
  });

  it('surfaces omitted context from the dispatch assembly, never silently', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-c', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-c',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return {
        opId: 'op-c',
        messageId: 'm-c',
        context: { estimatedInputTokens: 900, inputBudgetTokens: 512, droppedMessages: 3 },
      };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-c', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'a question');
    await user.keyboard('{Enter}');

    // The turn completed, but history was trimmed to fit: the user sees how
    // many messages were omitted instead of a silent drop.
    await screen.findByText(/Older messages were omitted/i);
    expect(screen.getByText(/Omitted messages:\s*3/)).not.toBeNull();
  });

  it('does not offer a Stop affordance in the text-only fallback flow', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    expect(screen.queryByRole('button', { name: /stop generation/i })).toBeNull();
  });

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
      return { opId: 'op-9', messageId: 'm-9', context: null };
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

  it('shows waiting from dispatch and effectuates a stop queued before the op handle; the turn is labelled cancelled', async () => {
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
        ...bootRows.items,
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
          text: '',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a',
          completion: 'Interrupted',
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
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, _payload, onEvent) => {
      // Connecting: the command (and its op handle) resolves at the terminal,
      // exactly like the real backend.
      emit = onEvent;
      return new Promise((resolve) => {
        resolveDispatch = resolve;
      });
    });
    backend.stopCompletion = vi.fn(async (_ws, _p, _s, opId) => {
      emit?.({
        opId,
        sequence: 9,
        event: { type: 'completed', completion: 'interrupted', truncated: false, usage: null },
      });
      resolveDispatch({ opId, messageId: 'm-9', context: null });
      return { opId, status: 'cancelled' };
    });
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    // Waiting begins at dispatch, before any channel event.
    await waitFor(() => expect(screen.getByText(/waiting for the model/i)).toBeDefined());
    // The stop affordance is reachable before any answer delta arrives.
    const stop = screen.getByRole('button', { name: /stop generation/i });
    await user.click(stop);
    // No op handle yet: the intent is queued, never dropped.
    expect(backend.stopCompletion).not.toHaveBeenCalled();

    // The first event carries the handle: the queued stop fires.
    await act(async () => {
      emit!({ opId: 'op-9', sequence: 1, event: { type: 'started' } });
    });
    await waitFor(() =>
      expect(backend.stopCompletion).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'op-9'),
    );

    // The authoritative rows carry the interruption, labelled honestly.
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeDefined());
    expect(screen.queryByText(/no answer was produced/i)).toBeNull();
    expect(screen.queryByText(/waiting for the model/i)).toBeNull();
  });

  it('shows thinking only on real activity; the streamed answer replaces the status', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const bootRows = { items: [], nextCursor: null, projectionPosition: '0' };
    const persistedRows = {
      items: [
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
          text: 'the answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a',
          completion: { Completed: { truncated: false } },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    };
    backend.getConversation.mockReset();
    backend.getConversation
      .mockResolvedValueOnce(bootRows)
      .mockResolvedValueOnce(bootRows)
      .mockResolvedValue(persistedRows);
    let emit: StreamEventParam | null = null;
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emit = onEvent;
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/waiting for the model/i)).toBeDefined());
    // No activity yet: the status never claims thinking on its own.
    expect(screen.queryByText(/thinking/i)).toBeNull();

    await act(async () => {
      emit!({ opId: 'op-9', sequence: 1, event: { type: 'thinking' } });
    });
    await waitFor(() => expect(screen.getByText(/thinking/i)).toBeDefined());

    await act(async () => {
      emit!({ opId: 'op-9', sequence: 2, event: { type: 'delta', text: 'the answer' } });
    });
    await waitFor(() => expect(screen.getAllByText('the answer')).toHaveLength(1));
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(screen.queryByText(/waiting for the model/i)).toBeNull();

    await act(async () => {
      emit!({
        opId: 'op-9',
        sequence: 3,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
    });
    // Handoff is exact: one rendering of the answer, and a normal completion
    // carries no lifecycle note.
    await waitFor(() => expect(screen.getAllByText('the answer')).toHaveLength(1));
    expect(screen.queryByText(/truncated by the length limit/i)).toBeNull();
    expect(screen.queryByText('Cancelled')).toBeNull();
  });

  it('labels persisted failed, cancelled, and truncated turns from the stored completion only', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'm1',
          role: 'user',
          text: 'did it work?',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'e1',
        },
        {
          messageId: 'm2',
          role: 'assistant',
          text: '',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'e2',
          completion: 'Failed',
        },
        {
          messageId: 'm3',
          role: 'assistant',
          text: 'half',
          createdAt: '2026-10-16T00:00:02Z',
          sourceEventId: 'e3',
          completion: { Completed: { truncated: true } },
        },
        {
          messageId: 'm4',
          role: 'assistant',
          text: 'partial',
          createdAt: '2026-10-16T00:00:03Z',
          sourceEventId: 'e4',
          completion: 'Interrupted',
        },
      ],
      nextCursor: null,
      projectionPosition: '4',
    });
    render(<ConversationPanel backend={backend} />);

    await screen.findByText('No answer was produced.');
    expect(screen.getByText('Truncated by the length limit.')).toBeDefined();
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('rejects a same-frame double send visibly instead of a silent no-op', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn(
      (_ws, _p, _s, _payload, _onEvent) => new Promise<CompletionStartDto>(() => {}),
    );
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await user.type(box, 'hi');

    // Two Enter presses in one React batch (no re-render in between): the
    // controller boundary rejects the second dispatch.
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/already being saved/i)).toBeDefined());
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
      return { opId: 'op-9', messageId: 'm-9', context: null };
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

  it('discloses that pasted attachments are not transmitted', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });

    await user.click(box);
    await user.paste('A'.repeat(2500));

    expect(screen.getByText(/will not be sent/i)).toBeDefined();
  });

  it('reloads history from the error banner without resubmitting', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });
    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());

    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-found',
          role: 'user',
          text: 'already saved',
          createdAt: '2026-10-09T00:00:03Z',
          sourceEventId: 'evt-9',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    await user.click(screen.getByRole('button', { name: /reload history/i }));

    await waitFor(() => expect(screen.getByText('already saved')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps text typed before the session is ready', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    let resolveBootstrap!: () => void;
    backend.getBootstrapState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = () =>
            resolve({
              isInitialized: true,
              activeWorkspaceId: 'ws-1',
              activeProjectId: 'proj-1',
            });
        }),
    );
    render(<ConversationPanel backend={backend} />);

    const box = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    await user.type(box, 'early thought');
    await act(async () => {
      resolveBootstrap();
    });
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('early thought'),
    );

    expect(box.value).toBe('early thought');
  });

  it('restores text typed before bootstrap across unmount and remount', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    // Bootstrap never resolves during the first mount.
    backend.getBootstrapState.mockImplementationOnce(() => new Promise(() => {}));
    const first = render(<ConversationPanel backend={backend} />);

    const box = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    await user.type(box, 'early thought');
    first.unmount();

    const secondBackend = fakeBackend();
    render(<ConversationPanel backend={secondBackend} />);
    const restored = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    // Restored from the pending bucket on mount, and kept once the
    // resolved session adopts it.
    expect(restored.value).toBe('early thought');
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('early thought'),
    );
    expect(restored.value).toBe('early thought');
  });

  it('never turns failed or unknown project discovery into an empty-project creation offer', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
    });
    const selection = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          {
            workspaceId: 'ws-1',
            name: 'WS 1',
            kind: 'personal',
            preferredLanguage: 'en',
            createdAt: '2026-10-09T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      listProjects: vi.fn().mockRejectedValue(new Error('discovery outage')),
      selectProject: vi.fn(),
    };
    render(<ConversationPanel backend={backend} selection={selection} />);

    // Renders WorkspaceSelection error / retry notice, never the project creation form
    await screen.findByText(/failed to load.*retry/i);
    expect(screen.queryByLabelText(/project name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /create project/i })).toBeNull();
  });

  it('chosen-workspace discovery: not-yet-loaded and failed lists never offer creation; successful empty discovery permits creation', () => {
    const baseSel = {
      workspaces: [
        {
          workspaceId: 'ws-chosen',
          name: 'Chosen WS',
          kind: 'personal' as const,
          preferredLanguage: 'en',
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      projectsBy: {},
      truncatedWorkspaces: false,
      truncatedProjects: {},
      failedProjectLists: [] as string[],
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
      loaded: true,
      listError: null,
      selectScope: vi.fn(),
      reload: vi.fn(),
      reloadProjects: vi.fn(),
      reloadActiveProjects: vi.fn(),
      isSelecting: false,
      selectError: null,
      hasRecords: true,
      hasProjectsFor: vi.fn(),
      hasEverSelected: true,
    };
    const prov = {
      isCreatingWorkspace: false,
      isCreatingProject: false,
      workspaceError: null,
      projectError: null,
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };

    const commonProps = {
      status: 'needs-workspace' as const,
      activeWorkspaceId: 'ws-1',
      provisionTransition: null,
      prov: prov as unknown as ConversationSetupSlotProps['prov'],
      formWorking: false,
      chosenWorkspaceId: 'ws-chosen',
      setChosenWorkspaceId: vi.fn(),
      onProvision: vi.fn(),
      onSelect: vi.fn(),
    };

    // 1. Not-yet-loaded chosen workspace: projectsBy has no entry for ws-chosen
    const notLoaded = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={baseSel as unknown as ConversationSetupSlotProps['sel']}
      />,
    );
    expect(notLoaded.queryByLabelText(/project name/i)).toBeNull();
    expect(notLoaded.queryByRole('button', { name: /create project/i })).toBeNull();
    notLoaded.unmount();

    // 2. Failed chosen workspace: failedProjectLists includes ws-chosen
    const failed = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={
          {
            ...baseSel,
            failedProjectLists: ['ws-chosen'],
            projectsBy: { 'ws-chosen': [] },
          } as unknown as ConversationSetupSlotProps['sel']
        }
      />,
    );
    expect(failed.queryByLabelText(/project name/i)).toBeNull();
    expect(failed.queryByRole('button', { name: /create project/i })).toBeNull();
    failed.unmount();

    // 3. Successful empty discovery: loaded, not failed, projectsBy confirmed empty array
    const emptySuccess = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={
          {
            ...baseSel,
            failedProjectLists: [],
            projectsBy: { 'ws-chosen': [] },
          } as unknown as ConversationSetupSlotProps['sel']
        }
      />,
    );
    expect(emptySuccess.getByLabelText(/project name/i)).toBeDefined();
    expect(emptySuccess.getByRole('button', { name: /create project/i })).toBeDefined();
    expect(emptySuccess.getByText(/first project in chosen ws/i)).toBeDefined();
    emptySuccess.unmount();
  });

  it('closes a crash-left provider operation through the dedicated recovery command, never a message resend', async () => {
    const backend = fakeBackend();
    const staleOp = {
      operationId: '01a14a4e-912d-728d-9a5b-235e6098ccb0',
      kind: 'provider-completion',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      createRequestId: null,
      messageRequestId: '01a14a4e-9400-728d-9a5b-235e6098ccb1',
      text: '',
      title: null,
      status: 'pending',
      createdAt: '2026-10-17T10:00:00Z',
    };
    backend.listPendingOperations
      .mockResolvedValueOnce({ operations: [staleOp], truncated: false })
      .mockResolvedValueOnce({ operations: [staleOp], truncated: false })
      .mockResolvedValue({ operations: [], truncated: false });

    render(<ConversationPanel backend={backend} />);

    // The message-recovery surface ignores provider handles; the dedicated
    // banner surfaces the stale operation instead.
    expect(await screen.findByText(/Unfinished generation/i)).toBeDefined();
    expect(screen.queryByText(/Review & Resend/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mark interrupted/i }));

    await waitFor(() => expect(backend.markCompletionInterrupted).toHaveBeenCalledTimes(1));
    expect(backend.markCompletionInterrupted).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', {
      operationId: staleOp.operationId,
      expectedMessageRequestId: staleOp.messageRequestId,
    });
    // Recovery never re-submits the prompt.
    expect(backend.submitMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Unfinished generation/i)).toBeNull());
  });
});
