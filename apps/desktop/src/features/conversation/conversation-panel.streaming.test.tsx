import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompletionStartDto } from '@adham/contracts-generated';
import type { StreamEventParam } from './conversation-test-utils';
import { ConversationPanel } from './conversation-panel';
import { fakeBackend, registryProvider, pickRegistryModel } from './conversation-panel-test-utils';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('ConversationPanel streaming', () => {
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
    expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:pending')).toBe('qwen2.5:latest');

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
    expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:sess-1')).toBe('qwen2.5:latest');
    expect(localStorage.getItem('adham:compose:model:ws-1:proj-1:pending')).toBeNull();
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
});
