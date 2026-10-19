import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, type StreamEventParam } from './conversation-test-utils';
import { useConversation } from './use-conversation';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
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
