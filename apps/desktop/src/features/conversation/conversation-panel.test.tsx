import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CompletionStartDto } from '@adham/contracts-generated';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    setActiveAlternative: vi.fn().mockResolvedValue([]),
    setAnswerFeedback: vi.fn().mockResolvedValue([]),
    markCompletionInterrupted: vi.fn().mockResolvedValue({ status: 'interrupted' }),
  };
}

type PanelProvider = NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;

/** Provider registry double with one pinned local model, mirroring Delivery A. */
function registryProvider(
  thinking = 'unknown',
  thinkingValues: string[] | null = null,
): PanelProvider {
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
            thinking,
            thinkingValues,
            thinkingDefault: null,
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

  it('keeps the explicit model choice per session across a remount and dispatches with it', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const payloads: { modelId?: string }[] = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload) => {
      payloads.push(payload as { modelId?: string });
      return { opId: 'op-1', messageId: 'm-1', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    const first = render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:model:sess-1')).toBe('qwen2.5:latest'),
    );

    // Reopen: the choice is restored from the session bucket, never re-picked
    // and never a discovery-order default.
    first.unmount();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    expect(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    ).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.modelId).toBe('qwen2.5:latest');
  });

  it('explains a vanished stored model and never silently substitutes another', async () => {
    const user = userEvent.setup();
    localStorage.setItem('adham:compose:model:sess-1', 'ghost:70b');
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The stale claim is named, the picker stays the only way to a usable
    // model, and the send is honestly the text-only path.
    await screen.findByText(/ghost:70b/);
    expect(screen.getByText(/no longer available/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Select a model' })).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.submitMessage).toHaveBeenCalled());
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });

  it('names the missing provider instead of leaving the model gap generic', async () => {
    const backend = fakeBackend();
    const provider = {
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      listModels: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof ConversationPanel>[0]['provider']>;
    render(<ConversationPanel backend={backend} provider={provider} />);

    await screen.findByText(/no model provider is connected/i);
    // With no account there is nothing to select, so no shallow picker.
    expect(screen.queryByRole('button', { name: 'Select a model' })).toBeNull();
    expect(provider.listModels).not.toHaveBeenCalled();
  });

  it('carries a stale pre-session pick into the session the first text-only send created', async () => {
    const user = userEvent.setup();
    // A pre-session pick that discovery no longer lists: the honest text-only
    // path creates the session, and the claim moves with it instead of being
    // silently dropped or silently replaced.
    localStorage.setItem('adham:compose:model:pending', 'ghost:70b');
    const backend = fakeBackend();
    backend.listSessions = vi.fn().mockResolvedValue({ sessions: [], truncated: false });
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText(/ghost:70b/);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'hi');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:model:sess-1')).toBe('ghost:70b'),
    );
    expect(localStorage.getItem('adham:compose:model:pending')).toBeNull();
    // The vanished claim is still the session's remembered choice: explained,
    // never silently substituted. (While the turn persisted, the provider list
    // was briefly unresolved, so the explained block returns only after ready.)
    await screen.findByText(/no longer available/i);
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
  });

  it('streams the first message into the session the first send creates', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.listSessions = vi.fn().mockResolvedValue({ sessions: [], truncated: false });
    const payloads: Array<{ modelId?: string; text?: string }> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as { modelId?: string; text?: string });
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'm-1', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    expect(localStorage.getItem('adham:compose:model:pending')).toBe('qwen2.5:latest');

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'first words');
    await user.keyboard('{Enter}');

    // The turn streams into the session the first send created — the text-only
    // path is never used, and the pick travels with the session.
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(backend.completeOnceStreaming).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'sess-1',
      expect.objectContaining({ modelId: 'qwen2.5:latest', text: 'first words' }),
      expect.any(Function),
    );
    expect(backend.submitMessage).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(backend.clearPendingOperation).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'resolved' }),
        undefined,
      ),
    );
    expect(localStorage.getItem('adham:compose:model:sess-1')).toBe('qwen2.5:latest');
    expect(localStorage.getItem('adham:compose:model:pending')).toBeNull();
  });

  it('returns the first message to the composer when its first dispatch is refused', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.listSessions = vi.fn().mockResolvedValue({ sessions: [], truncated: false });
    backend.completeOnceStreaming = vi.fn(async () => {
      throw new Error('policy denied');
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'first words');
    await user.keyboard('{Enter}');

    // The refusal is visible, the text returns to the composer, and the
    // tracked identity is dismissed rather than left as a phantom resend.
    await waitFor(() => expect(screen.getAllByText(/policy denied/i).length).toBeGreaterThan(0));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('first words'));
    await waitFor(() =>
      expect(backend.clearPendingOperation).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'dismissed' }),
        undefined,
      ),
    );
    expect(backend.submitMessage).not.toHaveBeenCalled();
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

  it('sends only model-documented thinking values, never for undocumented models', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<Record<string, unknown>> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      const opId = `op-t${payloads.length}`;
      onEvent({ opId, sequence: 0, event: { type: 'started' } });
      onEvent({
        opId,
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId, messageId: `m-${opId}`, context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-t1', status: 'cancelled' }));

    // Documented values: an off choice is dispatched as the boolean.
    const values = ['true', 'false', 'medium'];
    const first = render(
      <ConversationPanel backend={backend} provider={registryProvider('supported', values)} />,
    );
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await user.click(screen.getByRole('button', { name: /Select model/i }));
    await user.click(screen.getByLabelText(/Disable thinking/i));
    await user.keyboard('{Escape}');
    await user.type(box, 'think later');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]!.think).toBe(false);
    first.unmount();

    // A documented level travels verbatim. The choice is remembered across
    // the remount, so the picker re-opens on the same model — no re-pick.
    const second = render(
      <ConversationPanel backend={backend} provider={registryProvider('supported', values)} />,
    );
    const levelBox = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.click(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    );
    await user.click(screen.getByRole('button', { name: 'medium' }));
    await user.keyboard('{Escape}');
    await user.type(levelBox, 'think less');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]!.think).toBe('medium');
    second.unmount();

    // No documented values: no control, and no parameter on the wire. The
    // same remembered model is still the selection, so no re-pick either.
    render(<ConversationPanel backend={backend} provider={registryProvider('unknown')} />);
    const plainBox = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.click(
      await screen.findByRole('button', { name: /Current model is Qwen 2\.5 \(latest\)/i }),
    );
    expect(screen.queryByLabelText(/Disable thinking/i)).toBeNull();
    await user.keyboard('{Escape}');
    await user.type(plainBox, 'plain');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(3));
    expect('think' in payloads[2]!).toBe(false);
  });

  it('queues a send during a run visibly and dispatches it when the turn settles', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<Record<string, unknown>> = [];
    let emit: StreamEventParam | null = null;
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      if (payloads.length === 1) {
        // First turn: held open so a send arrives while it is running.
        emit = onEvent;
        return new Promise((resolve) => {
          resolveDispatch = resolve;
        });
      }
      onEvent({ opId: 'op-2', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-2',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return Promise.resolve({ opId: 'op-2', messageId: 'm-2', context: null });
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));

    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'first');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));

    // The composer stays usable during the run; Enter queues the instruction
    // visibly and acknowledges it (draft cleared, nothing injected).
    await user.type(box, 'second');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('second')).toBeDefined();
    expect(screen.getByText(/^queued$/i)).toBeDefined();
    expect(box.value).toBe('');

    // The settled turn dispatches the queued instruction through the same
    // path as a direct send.
    await act(async () => {
      emit!({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      resolveDispatch({ opId: 'op-1', messageId: 'm-1', context: null });
    });
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]!.text).toBe('second');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove queued instruction' })).toBeNull(),
    );
  });

  it('removes a queued instruction before it is dispatched', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    const payloads: Array<Record<string, unknown>> = [];
    let emit: StreamEventParam | null = null;
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      emit = onEvent;
      return new Promise((resolve) => {
        resolveDispatch = resolve;
      });
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));

    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);

    await user.type(box, 'first');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));

    // The pointer path queues too, and the visible queue has a cancel.
    await user.type(box, 'second');
    await user.click(screen.getByRole('button', { name: 'Queue instruction' }));
    await user.click(screen.getByRole('button', { name: 'Remove queued instruction' }));
    expect(screen.queryByRole('button', { name: 'Remove queued instruction' })).toBeNull();

    await act(async () => {
      emit!({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      resolveDispatch({ opId: 'op-1', messageId: 'm-1', context: null });
    });
    // The run settled with nothing left to dispatch.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stop generation/i })).toBeNull(),
    );
    expect(payloads).toHaveLength(1);
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

  it('renders assistant history as Markdown instead of literal markers', async () => {
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          text: '## Heading\n\n**bold** answer',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-1',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });

    render(<ConversationPanel backend={backend} />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeDefined());
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.queryByText(/^\*\*bold\*\*/)).toBeNull();
  });

  it('renders streamed Markdown live, including an incomplete fence', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({
        opId: 'op-9',
        sequence: 1,
        event: { type: 'delta', text: '## Running\n\n```ts\nconst x' },
      });
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

    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeDefined());
    expect(screen.getByText('Running')).toBeDefined();
    expect(screen.getByText('const x')).toBeDefined();
    expect(screen.queryByText(/```/)).toBeNull();

    // The live bubble is provisional: there is nothing persisted to rate.
    const live = screen.getByText('Running').closest('article') as HTMLElement;
    expect(within(live).queryByRole('button', { name: 'Like this answer' })).toBeNull();
    expect(within(live).queryByRole('button', { name: 'Dislike this answer' })).toBeNull();
  });

  it('retries the failed turn as a new attempt without resending the user message', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-user-1',
        role: 'user',
        text: 'retry me please',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-u1',
      },
      {
        messageId: 'msg-failed-1',
        role: 'assistant',
        text: 'no answer was produced',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-f1',
        completion: 'Failed',
      },
    ];
    backend.getConversation = vi.fn(async () => ({
      items: [...rows],
      nextCursor: null,
      projectionPosition: `${rows.length}`,
    }));
    const payloads: Array<Record<string, unknown>> = [];
    backend.retryCompletionStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as unknown as Record<string, unknown>);
      // The attempt the backend persists is visible on the reload after the
      // terminal, exactly like the real projection.
      rows.push({
        messageId: 'msg-asst-1',
        role: 'assistant',
        text: 'second attempt',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-a1',
        completion: { Completed: { truncated: false } },
      });
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'second attempt' } });
      onEvent({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'msg-user-1', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('no answer was produced');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      replyToMessageId: 'msg-user-1',
      mode: 'plan',
    });
    // The user turn is answered again, never re-sent as a new message.
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(backend.completeOnceStreaming).toBeUndefined();
    // The original attempt stays visible with its failure note; the newest
    // attempt is now the completed one, so the offered action is Regenerate.
    await screen.findByText('second attempt');
    expect(screen.getByText('no answer was produced')).toBeDefined();
    expect(screen.getByText(/Generation failed/i)).toBeDefined();
    await screen.findByRole('button', { name: 'Regenerate' });
  });

  it('states why a retry cannot run without a resolved model instead of a silent no-op', async () => {
    const backend = fakeBackend();
    backend.getConversation = vi.fn(async () => ({
      items: [
        {
          messageId: 'msg-user-1',
          role: 'user',
          text: 'retry me please',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-u1',
        },
        {
          messageId: 'msg-failed-1',
          role: 'assistant',
          text: 'no answer was produced',
          createdAt: '2026-10-09T00:00:01Z',
          sourceEventId: 'evt-f1',
          completion: 'Failed',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    }));
    backend.retryCompletionStreaming = vi.fn();
    backend.stopCompletion = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('no answer was produced');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Select a model to retry this turn/i)).toBeDefined();
    expect(backend.retryCompletionStreaming).not.toHaveBeenCalled();
  });

  it('sends a reply anchored to the persisted message id and shows the quote', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-0',
        role: 'user',
        text: 'earlier truth',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-0',
      },
      {
        messageId: 'msg-orphan',
        role: 'user',
        text: 'orphan quote',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-o',
        reference: { refersToMessageId: 'msg-gone', relation: 'replied' },
      },
    ];
    backend.getConversation = vi.fn(async () => ({
      items: [...rows],
      nextCursor: null,
      projectionPosition: `${rows.length}`,
    }));
    const payloads: Array<Record<string, unknown>> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      // The persisted reply becomes visible on the terminal reload, exactly
      // like the real projection.
      rows.push({
        messageId: 'msg-reply',
        role: 'user',
        text: 'quoted answer',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-r',
        reference: { refersToMessageId: 'msg-0', relation: 'replied' },
      });
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'msg-reply', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('earlier truth');
    // A reference whose target is not in the loaded history is stated,
    // never replaced by an invented excerpt.
    expect(screen.getByText('Quoted message is not in the loaded history.')).toBeDefined();

    await user.click(screen.getAllByRole('button', { name: 'Reply' })[0]!);
    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeDefined();

    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'quoted answer');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'quoted answer',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'replied' },
    });
    // Acknowledged: the pending quote chip is consumed, and the persisted
    // reply renders the quote from loaded history.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel reply' })).toBeNull());
    await screen.findByText('quoted answer');
    expect(screen.getAllByText('earlier truth').length).toBe(2);
  });

  it('refuses a reply without a resolved model instead of dropping the anchor', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'quoted answer');
    await user.keyboard('{Enter}');

    // The refusal is stated; nothing was sent (not even text-only), and both
    // the text and the anchor stay for a retry as a reply.
    expect(await screen.findByText('Select a model to send the reply.')).toBeDefined();
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeDefined();
    expect(box.value).toBe('quoted answer');
  });

  it('dispatches a queued reply with its anchor when the running turn settles', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const payloads: Array<Record<string, unknown>> = [];
    let emit: StreamEventParam | null = null;
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      if (payloads.length === 1) {
        emit = onEvent;
        return new Promise((resolve) => {
          resolveDispatch = resolve;
        });
      }
      onEvent({ opId: 'op-2', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-2',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return Promise.resolve({ opId: 'op-2', messageId: 'm-2', context: null });
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));

    render(<ConversationPanel backend={backend} provider={registryProvider()} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await pickRegistryModel(user);
    await screen.findByText('earlier truth');

    await user.type(box, 'first');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(payloads).toHaveLength(1));

    // A reply clicked during the run is queued as a reply: the queued row says
    // so, and the anchor travels with the instruction.
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await user.type(box, 'queued reply');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/^queued$/i)).toBeDefined();
    expect(screen.getByText('Reply', { selector: 'span' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancel reply' })).toBeNull();

    await act(async () => {
      emit!({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      resolveDispatch({ opId: 'op-1', messageId: 'm-1', context: null });
    });
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'queued reply',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'replied' },
    });
  });

  it('edits a persisted user prompt into a branch and shows the edit lineage', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    const rows: unknown[] = [
      {
        messageId: 'msg-0',
        role: 'user',
        text: 'original prompt',
        createdAt: '2026-10-09T00:00:00Z',
        sourceEventId: 'evt-0',
      },
      {
        messageId: 'msg-a',
        role: 'assistant',
        text: 'first answer',
        createdAt: '2026-10-09T00:00:01Z',
        sourceEventId: 'evt-a',
        completion: { Completed: { truncated: false } },
      },
    ];
    backend.getConversation = vi.fn(async () => ({
      items: [...rows],
      nextCursor: null,
      projectionPosition: `${rows.length}`,
    }));
    const payloads: Array<Record<string, unknown>> = [];
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, payload, onEvent) => {
      payloads.push(payload as Record<string, unknown>);
      // The persisted branch becomes visible on the terminal reload, exactly
      // like the real projection.
      rows.push({
        messageId: 'msg-branch',
        role: 'user',
        text: 'edited prompt',
        createdAt: '2026-10-09T00:00:02Z',
        sourceEventId: 'evt-b',
        reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
      });
      onEvent({ opId: 'op-1', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-1',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-1', messageId: 'msg-branch', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-1', status: 'cancelled' }));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await pickRegistryModel(user);
    await screen.findByText('original prompt');

    // Edit rewrites a prompt — user-only. The assistant row still offers Reply.
    const userCard = screen.getByRole('article', { name: 'You' });
    const assistantCard = screen.getByRole('article', { name: 'Assistant' });
    expect(within(userCard).getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(within(assistantCard).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(assistantCard).getByRole('button', { name: 'Reply' })).toBeDefined();

    await user.click(within(userCard).getByRole('button', { name: 'Edit' }));
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    // Edit prefills the original text and states the pending edit.
    expect(box.value).toBe('original prompt');
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDefined();

    await user.clear(box);
    await user.type(box, 'edited prompt');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'edited prompt',
      mode: 'plan',
      reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
    });
    // Acknowledged: the chip is consumed, and the persisted branch renders its
    // lineage ("Edited from"), not a reply quote.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel edit' })).toBeNull());
    await screen.findByText('edited prompt');
    expect(screen.getByText('Edited from')).toBeDefined();
    expect(screen.queryByText('Replying to')).toBeNull();
  });

  it('cancels an edit by restoring the draft it displaced', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    await user.type(box, 'draft in progress');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(box.value).toBe('earlier truth');

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));
    // The displaced draft comes back; nothing was sent.
    expect(screen.queryByRole('button', { name: 'Cancel edit' })).toBeNull();
    expect(box.value).toBe('draft in progress');
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('refuses an edit without a resolved model instead of dropping the lineage', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.completeOnceStreaming = vi.fn();
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    await screen.findByText('earlier truth');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;
    // The prefilled text is what a retry would send: Enter from the composer.
    await user.click(box);
    await user.keyboard('{Enter}');

    // The refusal is stated; nothing was sent (not even text-only), and both
    // the edited text and the lineage stay for a retry.
    expect(await screen.findByText('Select a model to send the edited prompt.')).toBeDefined();
    expect(backend.completeOnceStreaming).not.toHaveBeenCalled();
    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDefined();
    expect(box.value).toBe('earlier truth');
  });

  it('labels an edited branch, marks the newest edit active, and switches on demand', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'original prompt',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-branch',
          role: 'user',
          text: 'edited prompt',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-b',
          completion: null,
          reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [],
    });
    backend.setActiveAlternative = vi
      .fn()
      .mockResolvedValue([{ rootMessageId: 'msg-0', activeMessageId: 'msg-0' }]);
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const userCards = await screen.findAllByRole('article', { name: 'You' });
    // The quote block in the edited card repeats the original text, so the
    // cards are located by role and row order, not by text.
    const originalCard = userCards[0] as HTMLElement;
    const editedCard = userCards[1] as HTMLElement;
    // Default rule, the same one the backend applies: the newest edit is the
    // branch the session continues from.
    expect(within(editedCard).getByText('Active')).toBeDefined();
    expect(within(editedCard).queryByRole('button', { name: 'Make active' })).toBeNull();
    expect(within(originalCard).getByRole('button', { name: 'Make active' })).toBeDefined();

    await user.click(within(originalCard).getByRole('button', { name: 'Make active' }));

    // The switch goes to the server with the branch root; the chips follow the
    // response, never an optimistic guess.
    expect(backend.setActiveAlternative).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-0',
      'msg-0',
    );
    await waitFor(() => expect(within(originalCard).getByText('Active')).toBeDefined());
    expect(within(editedCard).getByRole('button', { name: 'Make active' })).toBeDefined();
  });

  it('shows the persisted selection on load and surfaces a refused switch', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'original prompt',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-branch',
          role: 'user',
          text: 'edited prompt',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-b',
          completion: null,
          reference: { refersToMessageId: 'msg-0', relation: 'edited-from' },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [{ rootMessageId: 'msg-0', activeMessageId: 'msg-0' }],
    });
    backend.setActiveAlternative = vi
      .fn()
      .mockRejectedValue(new Error('selection refused by the server'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The persisted selection, not the default, drives the labels.
    const userCards = await screen.findAllByRole('article', { name: 'You' });
    const originalCard = userCards[0] as HTMLElement;
    const editedCard = userCards[1] as HTMLElement;
    expect(within(originalCard).getByText('Active')).toBeDefined();

    await user.click(within(editedCard).getByRole('button', { name: 'Make active' }));

    // A refusal is stated and nothing flips: the chips still show the stored
    // selection.
    expect(await screen.findByText('selection refused by the server')).toBeDefined();
    expect(within(originalCard).getByText('Active')).toBeDefined();
    expect(within(editedCard).getByRole('button', { name: 'Make active' })).toBeDefined();
  });

  it('rates an answer, switches the verdict, and removes it on a second press', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-q',
          role: 'user',
          text: 'a question',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-q',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-a',
          role: 'assistant',
          text: 'an answer',
          createdAt: '2026-10-09T00:00:01Z',
          sourceEventId: 'evt-a',
          completion: { Completed: { truncated: false } },
          reference: null,
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [],
      feedback: [],
    });
    backend.setAnswerFeedback = vi
      .fn()
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'like', reason: null }])
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'dislike', reason: null }])
      .mockResolvedValueOnce([]);
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    const card = await screen.findByRole('article', { name: 'Assistant' });
    const like = within(card).getByRole('button', { name: 'Like this answer' });
    const dislike = within(card).getByRole('button', { name: 'Dislike this answer' });
    // Nothing stored yet: nothing is pressed, and there is no reason field.
    expect(like.getAttribute('aria-pressed')).toBe('false');
    expect(within(card).queryByRole('textbox', { name: 'Reason (optional)' })).toBeNull();

    await user.click(like);
    expect(backend.setAnswerFeedback).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'like',
      null,
    );
    // Only the stored verdict is ever pressed.
    await waitFor(() => expect(like.getAttribute('aria-pressed')).toBe('true'));
    expect(dislike.getAttribute('aria-pressed')).toBe('false');
    expect(within(card).getByRole('textbox', { name: 'Reason (optional)' })).toBeDefined();

    await user.click(dislike);
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('true'));
    expect(like.getAttribute('aria-pressed')).toBe('false');

    // A second press on the pressed verdict removes the feedback entirely.
    await user.click(dislike);
    expect(backend.setAnswerFeedback).toHaveBeenLastCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      null,
      null,
    );
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('false'));
    expect(within(card).queryByRole('textbox', { name: 'Reason (optional)' })).toBeNull();
  });

  it('keeps a stored verdict pressed on load and states a refused save', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation = vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-q',
          role: 'user',
          text: 'a question',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-q',
          completion: null,
          reference: null,
        },
        {
          messageId: 'msg-a',
          role: 'assistant',
          text: 'an answer',
          createdAt: '2026-10-09T00:00:01Z',
          sourceEventId: 'evt-a',
          completion: { Completed: { truncated: false } },
          reference: null,
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
      branchSelections: [],
      feedback: [{ messageId: 'msg-a', verdict: 'dislike', reason: null }],
    });
    backend.setAnswerFeedback = vi
      .fn()
      .mockResolvedValueOnce([{ messageId: 'msg-a', verdict: 'dislike', reason: 'too generic' }])
      .mockRejectedValueOnce(new Error('feedback refused by the server'));
    render(<ConversationPanel backend={backend} provider={registryProvider()} />);

    // The verdict read back with the history drives the pressed state.
    const card = await screen.findByRole('article', { name: 'Assistant' });
    const like = within(card).getByRole('button', { name: 'Like this answer' });
    const dislike = within(card).getByRole('button', { name: 'Dislike this answer' });
    await waitFor(() => expect(dislike.getAttribute('aria-pressed')).toBe('true'));
    expect(like.getAttribute('aria-pressed')).toBe('false');

    // The optional reason saves on Enter, on top of the current verdict.
    const reason = within(card).getByRole('textbox', { name: 'Reason (optional)' });
    await user.type(reason, 'too generic{Enter}');
    expect(backend.setAnswerFeedback).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'dislike',
      'too generic',
    );

    // A refused switch is stated and nothing flips. Focus + Enter proves the
    // buttons are keyboard reachable.
    like.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('feedback refused by the server')).toBeDefined();
    expect(backend.setAnswerFeedback).toHaveBeenLastCalledWith(
      'ws-1',
      'proj-1',
      'sess-1',
      'msg-a',
      'like',
      'too generic',
    );
    expect(dislike.getAttribute('aria-pressed')).toBe('true');
    expect(like.getAttribute('aria-pressed')).toBe('false');
  });
});
