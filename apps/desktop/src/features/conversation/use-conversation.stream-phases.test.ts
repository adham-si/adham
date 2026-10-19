import type { CompletionStartDto } from '@adham/contracts-generated';
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

describe('useConversation stream phases (Delivery A)', () => {
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
});
