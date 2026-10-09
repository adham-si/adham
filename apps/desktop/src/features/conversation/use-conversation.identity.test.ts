import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { fakeBackend, submitIds } from './conversation-test-utils';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useConversation request identity', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('sends a stable uuid request identity per logical send', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.submit('one');
    });
    await act(async () => {
      await result.current.submit('two');
    });

    const [first, second] = submitIds(backend);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  it('reuses the exact request identity when resending after an uncertain loss', async () => {
    const backend = fakeBackend();
    const stored = new Map<string, unknown>();
    let loseNext = true;
    backend.submitMessage.mockImplementation(
      async (
        _ws: string,
        _proj: string,
        _sess: string,
        payload: { text: string },
        options?: { requestId?: string },
      ) => {
        const id = options?.requestId ?? 'missing-id';
        if (stored.has(id)) return stored.get(id);
        const saved = {
          messageId: `msg-${id.slice(0, 8)}`,
          sessionId: 'sess-1',
          text: payload.text,
          createdAt: '2026-10-09T00:00:01Z',
          streamSequence: '1',
          projectionPosition: '1',
        };
        stored.set(id, saved);
        if (loseNext) {
          loseNext = false;
          throw new Error('connection lost after commit');
        }
        return saved;
      },
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: unknown;
    await act(async () => {
      first = await result.current.submit('hi');
    });
    expect(first).toEqual({ ok: false, uncertain: true, error: 'connection lost after commit' });

    let second: unknown;
    await act(async () => {
      second = await result.current.submit('hi');
    });
    expect(second).toEqual({ ok: true });

    const ids = submitIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(stored.size).toBe(1);
    expect(result.current.messages).toHaveLength(1);
  });

  it('marks envelope rejections definite and mints a new identity for the next send', async () => {
    const backend = fakeBackend();
    backend.submitMessage.mockRejectedValueOnce({
      protocolVersion: 1,
      code: 'VALIDATION_FAILED',
      messageKey: 'error.validationFailed',
      retryable: false,
      correlationId: 'corr-1',
      fieldErrors: [],
    });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hi');
    });
    expect(outcome).toEqual({ ok: false, uncertain: false, error: expect.any(String) });

    await act(async () => {
      await result.current.submit('hi again');
    });
    const ids = submitIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('preserves the request identity for a coded storage-unavailable rejection', async () => {
    const backend = fakeBackend();
    const stored = new Map<string, unknown>();
    let loseNext = true;
    backend.submitMessage.mockImplementation(
      async (
        _ws: string,
        _proj: string,
        _sess: string,
        payload: { text: string },
        options?: { requestId?: string },
      ) => {
        const id = options?.requestId ?? 'missing-id';
        if (stored.has(id)) return stored.get(id);
        const saved = {
          messageId: `msg-${id.slice(0, 8)}`,
          sessionId: 'sess-1',
          text: payload.text,
          createdAt: '2026-10-09T00:00:01Z',
          streamSequence: '1',
          projectionPosition: '1',
        };
        stored.set(id, saved);
        if (loseNext) {
          loseNext = false;
          // A coded storage failure is not proof of rollback.
          throw {
            protocolVersion: 1,
            code: 'STORAGE_UNAVAILABLE',
            messageKey: 'error.storageUnavailable',
            retryable: true,
            correlationId: 'corr-1',
            fieldErrors: [],
          };
        }
        return saved;
      },
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: unknown;
    await act(async () => {
      first = await result.current.submit('hi');
    });
    expect(first).toEqual(expect.objectContaining({ ok: false, uncertain: true }));

    let second: unknown;
    await act(async () => {
      second = await result.current.submit('hi');
    });
    expect(second).toEqual({ ok: true });

    const ids = submitIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(stored.size).toBe(1);
    expect(result.current.messages).toHaveLength(1);
  });

  it('yields one message when a lost acknowledgement is resent after remount', async () => {
    const backend = fakeBackend();
    const stored = new Map<string, unknown>();
    let loseNext = true;
    backend.submitMessage.mockImplementation(
      async (
        _ws: string,
        _proj: string,
        _sess: string,
        payload: { text: string },
        options?: { requestId?: string },
      ) => {
        const id = options?.requestId ?? 'missing-id';
        if (stored.has(id)) return stored.get(id);
        const saved = {
          messageId: `msg-${id.slice(0, 8)}`,
          sessionId: 'sess-1',
          text: payload.text,
          createdAt: '2026-10-09T00:00:01Z',
          streamSequence: '1',
          projectionPosition: '1',
        };
        stored.set(id, saved);
        if (loseNext) {
          loseNext = false;
          throw new Error('connection lost after commit');
        }
        return saved;
      },
    );
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));

    let outcome: unknown;
    await act(async () => {
      outcome = await first.result.current.submit('hi');
    });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, uncertain: true }));
    first.unmount();

    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    await act(async () => {
      outcome = await second.result.current.submit('hi');
    });
    expect(outcome).toEqual({ ok: true });

    const ids = submitIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(stored.size).toBe(1);
  });

  it('blocks a different-text send while a previous write is unresolved', async () => {
    const backend = fakeBackend();
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.submit('first words');
    });
    expect(result.current.status).toBe('error');

    backend.submitMessage.mockClear();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('different words');
    });
    expect(outcome).toEqual(
      expect.objectContaining({
        ok: false,
        uncertain: true,
        error: expect.stringMatching(/unknown save status/i),
      }),
    );
    expect(backend.submitMessage).not.toHaveBeenCalled();
  });

  it('does not transfer an uncertain write identity to another session', async () => {
    const backend = fakeBackend();
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.submit('hi');
    });
    expect(result.current.status).toBe('error');

    await act(async () => {
      await result.current.openSession('sess-2');
    });
    await waitFor(() => expect(result.current.sessionId).toBe('sess-2'));

    await act(async () => {
      await result.current.submit('hi');
    });
    const ids = submitIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('rejects an overlapping submit at the controller boundary', async () => {
    const backend = fakeBackend();
    let resolveFirst!: (value: unknown) => void;
    backend.submitMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<unknown>;
    let second: Promise<unknown>;
    let firstOutcome: unknown;
    let secondOutcome: unknown;
    await act(async () => {
      first = result.current.submit('one');
      second = result.current.submit('two');
      resolveFirst({
        messageId: 'msg-1',
        sessionId: 'sess-1',
        text: 'one',
        createdAt: '2026-10-09T00:00:01Z',
        streamSequence: '1',
        projectionPosition: '1',
      });
      firstOutcome = await first;
      secondOutcome = await second;
    });

    expect(firstOutcome).toEqual({ ok: true });
    expect(secondOutcome).toEqual({
      ok: false,
      uncertain: false,
      error: 'A message is already being saved.',
    });
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });
});
