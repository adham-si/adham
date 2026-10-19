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
