import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from './conversation-test-utils';
import { useConversation } from './use-conversation';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConversation retry/regenerate (Delivery A)', () => {
  function retryBackend() {
    const backend = fakeBackend();
    backend.retryCompletionStreaming = vi.fn(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      onEvent({ opId: 'op-9', sequence: 1, event: { type: 'delta', text: 'second attempt' } });
      onEvent({
        opId: 'op-9',
        sequence: 2,
        event: { type: 'completed', completion: 'completed', truncated: false, usage: null },
      });
      return { opId: 'op-9', messageId: 'msg-user-9', context: null };
    });
    backend.stopCompletion = vi.fn(async () => ({ opId: 'op-9', status: 'cancelled' }));
    // Authoritative history: the retried user turn, its original failed
    // attempt, and the new attempt appended by this dispatch.
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-user-9',
          role: 'user',
          text: 'retry me',
          createdAt: '2026-10-16T00:00:00Z',
          sourceEventId: 'evt-u9',
        },
        {
          messageId: 'msg-failed-9',
          role: 'assistant',
          text: 'no answer',
          createdAt: '2026-10-16T00:00:01Z',
          sourceEventId: 'evt-f9',
          completion: 'Failed',
        },
        {
          messageId: 'msg-asst-9',
          role: 'assistant',
          text: 'second attempt',
          createdAt: '2026-10-16T00:00:02Z',
          sourceEventId: 'evt-a9',
          completion: { Completed: { truncated: false } },
        },
      ],
      nextCursor: null,
      projectionPosition: '9',
    });
    return backend;
  }

  it('dispatches one new attempt for the existing user turn and preserves the original rows', async () => {
    const backend = retryBackend();
    const dispatch = backend.retryCompletionStreaming!;
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.retryTurn('msg-user-9', 'acc-1', 'qwen2.5:latest', 'plan');
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[3]).toEqual({
      accountId: 'acc-1',
      modelId: 'qwen2.5:latest',
      replyToMessageId: 'msg-user-9',
      mode: 'plan',
    });
    // No user message is re-sent: the turn is answered again, not duplicated.
    expect(outcome).toEqual({ ok: true });
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.map((m) => m.id)).toEqual([
      'msg-user-9',
      'msg-failed-9',
      'msg-asst-9',
    ]);
  });

  it('refuses to retry without the capability and says why', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      outcome = (await result.current.retryTurn(
        'msg-user-9',
        'acc-1',
        'qwen2.5:latest',
        'plan',
      )) as {
        ok: boolean;
        error?: string;
      };
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/not ready/i);
    expect(result.current.streaming).toBeNull();
  });

  it('states a rejected retry dispatch and never writes an optimistic user row', async () => {
    const backend = retryBackend();
    backend.retryCompletionStreaming!.mockImplementation(async (_ws, _p, _s, _payload, onEvent) => {
      onEvent({ opId: 'op-9', sequence: 0, event: { type: 'started' } });
      throw new Error('RETRY_NOT_LATEST_TURN: only the latest user turn can be retried');
    });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    // A later reload would be observable; the failed dispatch must not reload
    // (nothing was written) and must not invent a user bubble.
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-other',
          role: 'user',
          text: 'should not appear',
          createdAt: '2026-10-16T00:00:03Z',
          sourceEventId: 'evt-o9',
        },
      ],
      nextCursor: null,
      projectionPosition: '10',
    });

    let outcome: { ok: boolean; uncertain?: boolean; error?: string } = { ok: true };
    await act(async () => {
      outcome = (await result.current.retryTurn(
        'msg-user-9',
        'acc-1',
        'qwen2.5:latest',
        'plan',
      )) as { ok: boolean; uncertain?: boolean; error?: string };
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(true);
    expect(outcome.error).toMatch(/RETRY_NOT_LATEST_TURN/);
    expect(result.current.error).toMatch(/RETRY_NOT_LATEST_TURN/);
    expect(result.current.streaming).toBeNull();
    expect(result.current.messages.map((m) => m.id)).toEqual([
      'msg-user-9',
      'msg-failed-9',
      'msg-asst-9',
    ]);
  });
});
