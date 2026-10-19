import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from './conversation-test-utils';
import { useConversation } from './use-conversation';

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
