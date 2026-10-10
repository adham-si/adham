import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { submissionNotice } from './submission-notice';
import { fakeBackend } from './conversation-test-utils';

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
    const { result } = renderHook(() => useConversation({ backend }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(backend.createSession).toHaveBeenCalledTimes(1);
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
    expect(backend.createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(backend.getConversation).toHaveBeenCalledTimes(2);
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
  it('reports execution and stop as unsupported by the backend', async () => {
    const backend = fakeBackend();
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.capabilities).toEqual({
      submitMessage: true,
      execution: false,
      stop: false,
    });
  });
});

describe('submissionNotice', () => {
  it('always discloses that the model selection is not applied', () => {
    expect(submissionNotice({ attachmentCount: 0, hasCustomSettings: false })).toMatch(
      /model selection is not applied/i,
    );
  });

  it('warns that attachments are not transmitted', () => {
    expect(submissionNotice({ attachmentCount: 2, hasCustomSettings: false })).toMatch(
      /attachment/i,
    );
  });

  it('warns that model and scope settings are not applied', () => {
    expect(submissionNotice({ attachmentCount: 0, hasCustomSettings: true })).toMatch(
      /not applied|not sent/i,
    );
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

    expect(backend.createSession).toHaveBeenCalledTimes(1);
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

    expect(backend.createSession).toHaveBeenCalledTimes(1);

    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '1',
    });
    await act(async () => {
      await second.result.current.retry();
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.sessionId).toBe('sess-1');
  });

  it('creates no extra session when history fails after a successful create', async () => {
    const backend = fakeBackend();
    backend.getConversation.mockRejectedValueOnce(new Error('history outage'));
    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('error'));
    expect(backend.createSession).toHaveBeenCalledTimes(1);
    first.unmount();

    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '1',
    });
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(backend.createSession).toHaveBeenCalledTimes(1);
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
    backend.createSession.mockResolvedValueOnce({
      sessionId: 'sess-2',
      projectId: 'proj-2',
      title: null,
      createdAt: '2026-10-09T00:00:05Z',
    });
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(backend.createSession).toHaveBeenCalledTimes(2);
    expect(second.result.current.sessionId).toBe('sess-2');
    expect(second.result.current.context).toEqual({
      workspaceId: 'ws-1',
      projectId: 'proj-2',
      sessionId: 'sess-2',
    });
  });

  it('retries an uncertain creation with the same request identity', async () => {
    const backend = fakeBackend();
    backend.createSession.mockRejectedValueOnce(new Error('connection lost'));
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    backend.createSession.mockResolvedValueOnce({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    });
    await act(async () => {
      await result.current.retry();
    });

    const ids = creationIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ids[0]).toBe(ids[1]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('does not create a session when the create intent cannot be recorded', async () => {
    const backend = fakeBackend();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    // Dispatch blocked: no session without a durable creation identity.
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toMatch(/identity could not be recorded/i);
  });

  it('retains the create intent when the session cache write fails', async () => {
    const backend = fakeBackend();
    const originalSetItem = Storage.prototype.setItem;
    let failCache = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'adham:compose:session' && failCache) {
        failCache = false;
        throw new Error('quota exceeded');
      }
      originalSetItem.call(this, key, value);
    });

    const first = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    // Cache write failed, so the intent must have survived.
    expect(sessionStorage.getItem('adham:compose:session')).toBeNull();
    expect(sessionStorage.getItem('adham:compose:create-intent')).not.toBeNull();
    first.unmount();

    // The remount replays creation with the SAME request identity, so the
    // backend receipt cannot fork a duplicate session.
    const second = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(backend.createSession).toHaveBeenCalledTimes(2);
    const ids = creationIds(backend);
    expect(ids[0]).toBe(ids[1]);
    expect(sessionStorage.getItem('adham:compose:session')).not.toBeNull();
    expect(sessionStorage.getItem('adham:compose:create-intent')).toBeNull();
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
    // Drain the initial bootstrap history call.
    await waitFor(() => expect(backend.getConversation).toHaveBeenCalled());
    await act(async () => {
      resolvers.shift()?.({
        items: [],
        nextCursor: null,
        projectionPosition: '0',
      });
    });
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
