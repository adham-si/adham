import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CompletionStartDto } from '@adham/contracts-generated';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { submissionNotice } from './submission-notice';
import { fakeBackend, type StreamEventParam } from './conversation-test-utils';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConversation submit', () => {
  it('submits text through the backend and shows the backend-issued message', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });

    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-1', text: 'hello' }),
    ]);
  });

  it('reports failure without throwing so the caller can retain the draft', async () => {
    const backend = fakeBackend();
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });

    expect(outcome).toEqual({ ok: false, uncertain: true, error: 'IPC offline' });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('error');
  });

  it('creates the session once when mounted under StrictMode replay', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    const { result } = renderHook(() => useConversation({ backend }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();

    await act(async () => {
      await result.current.submit('first message');
    });
    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBe('sess-1');
  });

  it('reports needs-workspace without provisioning when bootstrap has no context', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: false,
      activeWorkspaceId: null,
      activeProjectId: null,
    });
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('needs-workspace'));
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
  });

  it('reports needs-project without creating a session when no project is active', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
    });
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('needs-project'));
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
  });

  it('retries history load without creating a second session', async () => {
    const backend = fakeBackend();
    backend.getConversation
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce({ items: [], nextCursor: null, projectionPosition: '1' });
    const { result } = renderHook(() => useConversation({ backend }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(backend.createSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retry();
    });

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(backend.getConversation).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('ignores a late submit response after the session changes', async () => {
    const backend = fakeBackend();
    let resolveSubmit!: (value: unknown) => void;
    backend.submitMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    let submitPromise: Promise<unknown>;
    await act(async () => {
      submitPromise = result.current.submit('hello');
    });
    await act(async () => {
      await result.current.openSession('sess-2');
    });
    await act(async () => {
      resolveSubmit({
        messageId: 'msg-late',
        sessionId: 'sess-1',
        text: 'hello',
        createdAt: '2026-10-09T00:00:01Z',
        streamSequence: '1',
        projectionPosition: '1',
      });
      outcome = await submitPromise;
    });

    expect(outcome).toEqual({
      ok: false,
      uncertain: false,
      error: 'Session changed while sending.',
    });
    expect(result.current.messages).toEqual([]);
  });
});

describe('conversation capabilities', () => {
  it('reports stop as supported (stop_completion exists), execution still not', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.capabilities).toEqual({
      submitMessage: true,
      execution: false,
      stop: true,
    });
  });
});

describe('submissionNotice', () => {
  it('discloses that the model selection is not applied when no model is wired', () => {
    expect(submissionNotice({ attachmentCount: 0 })).toMatch(/model selection is not applied/i);
  });

  it('stays silent when the selected model is applied through streaming', () => {
    expect(submissionNotice({ attachmentCount: 0, modelApplied: true })).toBe('');
  });

  it('warns that attachments are not transmitted', () => {
    expect(submissionNotice({ attachmentCount: 2 })).toMatch(/attachment/i);
  });
});

describe('useConversation streaming (Delivery A)', () => {
  function streamingBackend(holdTerminal: boolean) {
    const backend = fakeBackend();
    let emit: StreamEventParam | null = null;
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emit = onEvent;
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => {
      if (holdTerminal && emit) {
        emit({
          opId: 'op-9',
          sequence: 8,
          event: { type: 'completed', completion: 'interrupted', truncated: false, usage: null },
        });
      }
      return { opId: 'op-9', status: 'cancelled' };
    });
    // terminal reload: authoritative partial persisted server-side
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-user-9',
          role: 'user',
          text: 'hi',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'evt-u9',
        },
        {
          messageId: 'msg-asst-9',
          role: 'assistant',
          text: 'partial answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a9',
        },
      ],
      nextCursor: null,
      projectionPosition: '9',
    });
    return backend;
  }

  it('streams deltas, appends them, and reloads the persisted history on the terminal', async () => {
    const backend = streamingBackend(false);
    const dispatch = backend.completeOnceStreaming!;
    dispatch.mockImplementation(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      onEvent({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[3]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      text: 'hi',
      mode: 'plan',
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ text: 'hi' }),
      expect.objectContaining({ text: 'partial answer' }),
    ]);
  });

  it('stop_completion halts the stream; the persisted partial lands on reload', async () => {
    const backend = streamingBackend(true);
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    let stopOutcome: unknown;
    let streamPromise!: Promise<unknown>;
    await act(async () => {
      streamPromise = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    // Live streamed deltas render in the composer state; no terminal yet.
    expect(result.current.streaming?.text).toBe('partial answer');

    await act(async () => {
      stopOutcome = await result.current.stop();
    });
    expect(stopOutcome).toEqual({ ok: true });
    expect(backend.stopCompletion).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'op-9');

    // The Interrupted terminal resolves the stream and reloads the
    // authoritative rows (user turn + persisted partial).
    await act(async () => {
      outcome = await streamPromise;
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ text: 'hi' }),
      expect.objectContaining({ text: 'partial answer' }),
    ]);
  });

  it('waits from dispatch, honours a stop queued before the op handle, and labels the interrupted row', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-u9',
          role: 'user',
          text: 'hi',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'evt-u9',
        },
        {
          messageId: 'msg-a9',
          role: 'assistant',
          text: '',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a9',
          completion: 'Interrupted',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    let emit: StreamEventParam | null = null;
    let resolveDispatch!: (start: CompletionStartDto) => void;
    backend.completeOnceStreaming = vi.fn((_ws, _p, _s, _payload, onEvent) => {
      // connecting: the command (and its op handle) resolves only at the
      // terminal, exactly like the real backend
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

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let streamPromise!: Promise<unknown>;
    await act(async () => {
      streamPromise = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    // waiting begins at dispatch, before any channel event
    expect(result.current.streaming?.phase).toBe('waiting');
    expect(result.current.streaming?.opId).toBe('');
    expect(result.current.streaming?.text).toBe('');
    expect(emit).not.toBeNull();

    // Stop before the op handle arrives is queued, not rejected…
    let stopOutcome: unknown;
    await act(async () => {
      stopOutcome = await result.current.stop();
    });
    expect(stopOutcome).toEqual({ ok: true });
    expect(backend.stopCompletion).not.toHaveBeenCalled();

    // …and effectuated the moment an event carries the handle.
    await act(async () => {
      emit!({ opId: 'op-9', sequence: 1, event: { type: 'started' } });
    });
    await waitFor(() =>
      expect(backend.stopCompletion).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-1', 'op-9'),
    );

    await act(async () => {
      await streamPromise;
    });
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ text: '', completion: { state: 'interrupted' } }),
    );
  });

  it('shows thinking only after real reasoning activity, never from elapsed time', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-a9',
          role: 'assistant',
          text: 'the answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-a9',
          completion: { Completed: { truncated: false } },
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    let emit: StreamEventParam | null = null;
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emit = onEvent;
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn();

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let streamPromise!: Promise<unknown>;
    await act(async () => {
      streamPromise = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    expect(result.current.streaming?.phase).toBe('waiting');

    // no activity yet: time alone must not fabricate a thinking status
    expect(result.current.streaming?.phase).toBe('waiting');

    await act(async () => {
      emit!({ opId: 'op-9', sequence: 1, event: { type: 'thinking' } });
    });
    expect(result.current.streaming?.phase).toBe('thinking');

    await act(async () => {
      emit!({ opId: 'op-9', sequence: 2, event: { type: 'delta', text: 'the answer' } });
    });
    expect(result.current.streaming?.phase).toBe('streaming');
    expect(result.current.streaming?.text).toBe('the answer');

    await act(async () => {
      emit!({
        opId: 'op-9',
        sequence: 3,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      await streamPromise;
    });
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        text: 'the answer',
        completion: { state: 'completed', truncated: false },
      }),
    );
  });

  it('handoff drops the live bubble before the authoritative rows land (partial renders once)', async () => {
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
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
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
    // Boot consumes two reads (session resolution + history). The post-terminal
    // reload is held back to expose the handoff ordering.
    backend.getConversation
      .mockResolvedValueOnce(bootRows as never)
      .mockResolvedValueOnce(bootRows as never)
      // gated post-terminal reload
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseReload = () => resolve(persistedRows as never);
          }) as never,
      )
      .mockResolvedValue(persistedRows as never);
    let releaseReload: (() => void) | null = null;
    let emitLocal: StreamEventParam | null = null;
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emitLocal = onEvent;
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let streamPromise!: Promise<unknown>;
    await act(async () => {
      streamPromise = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    expect(result.current.streaming?.text).toBe('partial answer');

    await act(async () => {
      emitLocal?.({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
    });
    // The live bubble is gone while the authoritative rows are still held
    // back — the streamed text is never rendered in two places.
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.filter((m) => m.text === 'partial answer')).toHaveLength(0);

    releaseReload!();
    let outcome: unknown;
    await act(async () => {
      outcome = await streamPromise;
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.messages.filter((m) => m.text === 'partial answer')).toHaveLength(1);
  });

  it('a late duplicate terminal after stop resolves once and reloads once', async () => {
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
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
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
    backend.getConversation
      .mockResolvedValueOnce(bootRows as never)
      .mockResolvedValueOnce(bootRows as never)
      .mockResolvedValue(persistedRows as never);
    let emitLocal: StreamEventParam | null = null;
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      emitLocal = onEvent;
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'partial answer' } });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => {
      // Server-side Interrupted terminal arrives with the stop response.
      emitLocal?.({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'interrupted', truncated: false, usage: null },
      });
      return { opId: 'op-9', status: 'cancelled' };
    });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let streamPromise!: Promise<unknown>;
    await act(async () => {
      streamPromise = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    expect(result.current.streaming?.text).toBe('partial answer');

    let stopOutcome: unknown;
    await act(async () => {
      stopOutcome = await result.current.stop();
    });
    expect(stopOutcome).toEqual({ ok: true });
    let outcome: unknown;
    await act(async () => {
      outcome = await streamPromise;
    });
    expect(outcome).toEqual({ ok: true });
    const reloadsAfterStop = backend.getConversation.mock.calls.length;

    // A duplicate terminal that races in after resolution must be ignored.
    await act(async () => {
      emitLocal?.({
        opId: 'op-9',
        sequence: 3,
        event: {
          type: 'completed',
          completion: 'completed',
          truncated: false,
          usage: { inputTokens: 1, outputTokens: 1 } as never,
        },
      });
    });
    expect(backend.getConversation.mock.calls.length).toBe(reloadsAfterStop);
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.filter((m) => m.text === 'partial answer')).toHaveLength(1);
  });

  it('keeps the streamed answer as a recovery snapshot when the terminal reload fails, then swaps to authoritative history on retry', async () => {
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
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
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
    // boot ×2 → post-terminal reload REJECTS → retry succeeds
    backend.getConversation
      .mockResolvedValueOnce(bootRows as never)
      .mockResolvedValueOnce(bootRows as never)
      .mockRejectedValueOnce(new Error('history read failed'))
      .mockResolvedValue(persistedRows as never);
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
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });

    // The turn itself succeeded (terminal, persisted server-side); the
    // answer stays visible as a non-authoritative snapshot, the history
    // read failure is surfaced as the retryable sync error, and nothing
    // was re-generated.
    expect(outcome).toEqual({ ok: true });
    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    expect(result.current.streaming).toBeNull();
    expect(result.current.recoverySnapshot).toEqual(
      expect.objectContaining({ role: 'assistant', text: 'partial answer' }),
    );
    expect(result.current.messages.filter((m) => m.text === 'partial answer')).toHaveLength(0);
    expect(result.current.status).toBe('error');

    // Retry is a history reload, never a second generation.
    await act(async () => {
      outcome = await result.current.reload();
    });
    expect(backend.completeOnceStreaming).toHaveBeenCalledTimes(1);
    expect(result.current.recoverySnapshot).toBeNull();
    expect(result.current.messages.filter((m) => m.text === 'partial answer')).toHaveLength(1);
    expect(result.current.status).toBe('ready');
  });

  it('never leaves an empty recovery bubble when the terminal arrived before any delta', async () => {
    const backend = fakeBackend();
    const emptyTurn = {
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    };
    backend.getConversation
      .mockResolvedValueOnce(emptyTurn as never)
      .mockResolvedValueOnce(emptyTurn as never)
      .mockResolvedValue(emptyTurn as never);
    backend.completeOnceStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({
        opId: 'op-9',
        sequence: 1,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'm-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.recoverySnapshot).toBeNull();
  });

  it('rejects an overlapping dispatch while a completion is streaming', async () => {
    const backend = streamingBackend(true);
    let releaseStream!: () => void;
    backend.completeOnceStreaming = vi.fn(
      (_ws, _p, _s, _payload, onEvent) =>
        new Promise((resolve) => {
          releaseStream = () => {
            onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
            onEvent({
              opId: 'op-9',
              sequence: 1,
              event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
            });
            resolve({ opId: 'op-9', messageId: 'm-9', context: null });
          };
        }),
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first!: Promise<unknown>;
    let second: unknown;
    await act(async () => {
      first = result.current.streamOnce('hi', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    await act(async () => {
      second = await result.current.streamOnce('again', 'acc-1', 'qwen2.5:latest', 'plan');
    });
    expect(second).toMatchObject({ ok: false });

    await act(async () => {
      releaseStream();
      await first;
    });
    expect(result.current.streaming).toBeNull();
  });
});

describe('useConversation reload', () => {
  it('refreshes history without resubmitting anything', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-9',
          role: 'user',
          text: 'reloaded',
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: 'evt-9',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(backend.submitMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-9', text: 'reloaded' }),
    ]);
  });
});

describe('useConversation session reuse', () => {
  function creationIds(backend: ReturnType<typeof fakeBackend>) {
    return backend.createSession.mock.calls.map(
      (call) => (call[3] as { requestId?: string } | undefined)?.requestId,
    );
  }

  it('reuses a verified cached session across unmount and remount', async () => {
    const backend = fakeBackend();
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(first.result.current.sessionId).toBe('sess-1');
    first.unmount();

    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(second.result.current.sessionId).toBe('sess-1');
  });

  it('retains the cached session across a transient history outage', async () => {
    const backend = fakeBackend();
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();

    // A history failure is an outage, never evidence the session is gone.
    backend.getConversation.mockRejectedValueOnce(new Error('storage briefly unavailable'));
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('error'));

    expect(backend.createSession).not.toHaveBeenCalled();

    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '1',
    });
    await act(async () => {
      await second.result.current.retry();
    });

    expect(backend.createSession).not.toHaveBeenCalled();
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.sessionId).toBe('sess-1');
  });

  it('creates no extra session when history fails after a successful resume', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockRejectedValueOnce(new Error('history outage'));
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('error'));
    expect(backend.createSession).not.toHaveBeenCalled();
    first.unmount();

    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '1',
    });
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(second.result.current.sessionId).toBe('sess-1');
  });

  it('does not resume a cached session after the selection changes', async () => {
    const backend = fakeBackend();
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(first.result.current.sessionId).toBe('sess-1');
    first.unmount();

    // The user selected another project; the cached session belongs to the
    // old scope and must not be silently resumed.
    backend.getBootstrapState.mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-2',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 'sess-2',
          title: null,
          createdAt: '2026-10-09T00:00:05Z',
        },
      ],
      truncated: false,
    });
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(second.result.current.sessionId).toBe('sess-2');
    expect(second.result.current.context).toEqual({
      workspaceId: 'ws-1',
      projectId: 'proj-2',
      sessionId: 'sess-2',
    });
  });

  it('retries an uncertain creation with the same request identity', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    backend.createSession.mockRejectedValueOnce(new Error('connection lost'));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });
    expect(outcome).toEqual({
      ok: false,
      uncertain: true,
      error: expect.stringMatching(/connection lost/i),
    });

    backend.createSession.mockResolvedValueOnce({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    });
    let retryOutcome: unknown;
    await act(async () => {
      retryOutcome = await result.current.submit('hello');
    });
    expect(retryOutcome).toEqual({ ok: true });

    const ids = creationIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ids[0]).toBe(ids[1]);
    expect(result.current.sessionId).toBe('sess-1');
  });

  it('does not create a session when the create intent cannot be recorded', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });

    // Dispatch blocked: no session without a recorded creation identity.
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(outcome).toEqual({
      ok: false,
      uncertain: false,
      error: expect.stringMatching(/identity could not be recorded/i),
    });
  });

  it('retains pending first send when message send fails after creation', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC drop'));
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));

    await act(async () => {
      await first.result.current.submit('hello');
    });
    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);

    const pending = JSON.parse(sessionStorage.getItem('adham:compose:pending-first-send') ?? '{}');
    expect(pending.sessionId).toBe('sess-1');
    expect(pending.text).toBe('hello');
  });

  it('resolves a submit started before unmount without applying state', async () => {
    const backend = fakeBackend();
    let resolveSubmit!: (value: unknown) => void;
    backend.submitMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const hook = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    let outcome: unknown;
    let pending: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.submit('hello');
    });
    hook.unmount();
    await act(async () => {
      resolveSubmit({
        messageId: 'msg-late',
        sessionId: 'sess-1',
        text: 'hello',
        createdAt: '2026-10-09T00:00:01Z',
        streamSequence: '1',
        projectionPosition: '1',
      });
      outcome = await pending;
    });
    expect(outcome).toEqual({ ok: false, uncertain: false, error: expect.any(String) });
  });
});

describe('useConversation read ordering', () => {
  it('discards a history response that predates a confirmed submit', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let resolveHistory!: (value: unknown) => void;
    backend.getConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    let reloadPromise: Promise<void>;
    await act(async () => {
      reloadPromise = result.current.reload();
    });
    await act(async () => {
      await result.current.submit('fresh words');
    });
    await act(async () => {
      resolveHistory({ items: [], nextCursor: null, projectionPosition: '0' });
      await reloadPromise;
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'msg-1', text: 'hello' }),
    ]);
  });

  it('lets the later reload win when completions reverse', async () => {
    const backend = fakeBackend();
    const resolvers: Array<(value: unknown) => void> = [];
    backend.getConversation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result } = renderHook(() => useConversation({ backend }));
    // Drain initial bootstrap history calls.
    await waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(1));
    while (resolvers.length > 0) {
      const r = resolvers.shift();
      await act(async () => {
        r?.({
          items: [],
          nextCursor: null,
          projectionPosition: '0',
        });
      });
    }
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<void>;
    let second: Promise<void>;
    await act(async () => {
      first = result.current.reload();
    });
    await act(async () => {
      second = result.current.reload();
    });
    const page = (tag: string) => ({
      items: [
        {
          messageId: `msg-${tag}`,
          role: 'user',
          text: tag,
          createdAt: '2026-10-09T00:00:02Z',
          sourceEventId: `evt-${tag}`,
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    await act(async () => {
      resolvers[1]?.(page('second'));
      await second;
    });
    await act(async () => {
      resolvers[0]?.(page('first'));
      await first;
    });

    expect(result.current.messages).toEqual([expect.objectContaining({ id: 'msg-second' })]);
  });

  it('refuses to submit into the previous context after a failed switch', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBe('sess-1');

    backend.getConversation.mockRejectedValueOnce(new Error('gone'));
    await act(async () => {
      await result.current.openSession('sess-2');
    });
    expect(result.current.status).toBe('error');

    backend.submitMessage.mockClear();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello');
    });
    expect(outcome).toEqual(
      expect.objectContaining({
        ok: false,
        uncertain: false,
        error: expect.stringMatching(/switch/i),
      }),
    );
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('retries the requested session after a failed switch', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.getConversation.mockRejectedValueOnce(new Error('gone'));
    await act(async () => {
      await result.current.openSession('sess-2');
    });
    expect(result.current.status).toBe('error');

    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '1',
    });
    await act(async () => {
      await result.current.retry();
    });

    const historySessions = backend.getConversation.mock.calls.map((call) => call[2]);
    expect(historySessions[historySessions.length - 1]).toBe('sess-2');
    await waitFor(() => expect(result.current.sessionId).toBe('sess-2'));
  });
});
