import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { fakeBackend } from './conversation-test-utils';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockScopeB(backend: ReturnType<typeof fakeBackend>) {
  backend.getBootstrapState.mockResolvedValueOnce({
    isInitialized: true,
    activeWorkspaceId: 'ws-B',
    activeProjectId: 'proj-B',
  });
  backend.listSessions.mockResolvedValueOnce({
    sessions: [
      {
        sessionId: 'sess-B',
        title: null,
        createdAt: '2026-10-09T00:00:02Z',
      },
    ],
    truncated: false,
  });
  backend.getConversation.mockResolvedValueOnce({
    items: [],
    nextCursor: null,
    projectionPosition: '0',
  });
}

describe('useConversation cross-scope storage fencing & late completion guards', () => {
  it('fences superseded first-send creation against storage side effects: cannot overwrite newer session cache, remove newer create intent, or unlock old sends', async () => {
    const backend = fakeBackend();

    // 1. Scope A starts in ready-no-session (empty session list)
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-A',
      activeProjectId: 'proj-A',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [],
      truncated: false,
    });
    let resolveCreateA!: (value: unknown) => void;
    backend.createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreateA = resolve as (value: unknown) => void;
        }),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    // Scope A starts first send, which begins backend.createSession
    let sendPromiseA: Promise<unknown>;
    act(() => {
      sendPromiseA = result.current.submit('hello A');
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.createSession).toHaveBeenCalledWith(
      'ws-A',
      'proj-A',
      { title: 'hello A' },
      expect.objectContaining({ requestId: expect.any(String) }),
    );

    // 2. Before Scope A completes creation, out-of-band scope change to Scope B occurs
    mockScopeB(backend);
    await act(async () => {
      result.current.refreshScope();
    });

    // Scope B resolves to ready and stores Scope B session cache
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });
    const cacheAfterB = JSON.parse(sessionStorage.getItem('adham:compose:session') ?? '{}');
    expect(cacheAfterB).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });

    // Write a mock Scope B create intent to ensure it is not wiped by superseded Scope A
    sessionStorage.setItem(
      'adham:compose:create-intent',
      JSON.stringify({ requestId: 'intent-B', workspaceId: 'ws-B', projectId: 'proj-B' }),
    );

    // 3. Now, Scope A's createSession finally resolves late
    await act(async () => {
      resolveCreateA({
        sessionId: 'sess-A-late',
        projectId: 'proj-A',
        title: null,
        createdAt: '2026-10-09T00:00:01Z',
      });
      await sendPromiseA!;
    });

    // 4. Assert: Scope A DID NOT overwrite SESSION_CACHE_KEY
    const cacheAfterLateA = JSON.parse(sessionStorage.getItem('adham:compose:session') ?? '{}');
    expect(cacheAfterLateA).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });

    // Assert: Scope A DID NOT clear Scope B's create intent
    const intentAfterLateA = JSON.parse(
      sessionStorage.getItem('adham:compose:create-intent') ?? '{}',
    );
    expect(intentAfterLateA).toEqual({
      requestId: 'intent-B',
      workspaceId: 'ws-B',
      projectId: 'proj-B',
    });

    // Assert: Senders cannot send to Scope A
    backend.submitMessage.mockResolvedValueOnce({
      messageId: 'msg-B1',
      sessionId: 'sess-B',
      text: 'hello B',
      createdAt: '2026-10-09T00:00:03Z',
      streamSequence: '1',
      projectionPosition: '1',
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('hello B');
    });
    expect(outcome).toEqual({ ok: true });
    expect(backend.submitMessage).toHaveBeenCalledWith(
      'ws-B',
      'proj-B',
      'sess-B',
      { text: 'hello B' },
      expect.any(Object),
    );
    expect(backend.submitMessage.mock.calls.some((call) => call[0] === 'ws-A')).toBe(false);
  });

  it('late A bootstrap after B becomes current: no stale creation dispatch or storage mutation', async () => {
    const backend = fakeBackend();

    // 1. Initial bootstrap for Scope A hangs
    let resolveBootstrapA!: (value: unknown) => void;
    backend.getBootstrapState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrapA = resolve as (value: unknown) => void;
        }),
    );

    const { result } = renderHook(() => useConversation({ backend }));

    // 2. Out-of-band scope change to Scope B occurs
    mockScopeB(backend);
    await act(async () => {
      result.current.refreshScope();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });

    // Write a mock Scope B create intent
    sessionStorage.setItem(
      'adham:compose:create-intent',
      JSON.stringify({ requestId: 'intent-B', workspaceId: 'ws-B', projectId: 'proj-B' }),
    );

    // 3. Scope A bootstrap resolves late
    await act(async () => {
      resolveBootstrapA({
        isInitialized: true,
        activeWorkspaceId: 'ws-A',
        activeProjectId: 'proj-A',
      });
    });

    // 4. Assert: Scope A NEVER dispatched createSession (lazy creation on send only)
    expect(backend.createSession).not.toHaveBeenCalled();

    // Assert: Scope B cache and intent remain intact
    const cache = JSON.parse(sessionStorage.getItem('adham:compose:session') ?? '{}');
    expect(cache).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });
    const intent = JSON.parse(sessionStorage.getItem('adham:compose:create-intent') ?? '{}');
    expect(intent).toEqual({
      requestId: 'intent-B',
      workspaceId: 'ws-B',
      projectId: 'proj-B',
    });
  });

  it('late A creation rejection: neither overwrites B’s cache nor clears B’s intent', async () => {
    const backend = fakeBackend();

    // 1. Initial bootstrap for Scope A resolves to ready-no-session
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-A',
      activeProjectId: 'proj-A',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [],
      truncated: false,
    });
    let rejectCreateA!: (err: unknown) => void;
    backend.createSession.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectCreateA = reject;
        }),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    // Scope A starts first send, which begins backend.createSession
    let sendPromiseA: Promise<unknown>;
    act(() => {
      sendPromiseA = result.current.submit('hello A');
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));

    // 2. Out-of-band scope change to Scope B occurs
    mockScopeB(backend);
    await act(async () => {
      result.current.refreshScope();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });

    // Write a mock Scope B create intent
    sessionStorage.setItem(
      'adham:compose:create-intent',
      JSON.stringify({ requestId: 'intent-B', workspaceId: 'ws-B', projectId: 'proj-B' }),
    );

    // 3. Scope A's createSession rejects late with a definite pre-effect rejection
    await act(async () => {
      rejectCreateA({
        code: 'VALIDATION_FAILED',
        messageKey: 'error.validationFailed',
      });
      await sendPromiseA!;
    });

    // 4. Assert: Scope B cache and intent remain intact
    const cache = JSON.parse(sessionStorage.getItem('adham:compose:session') ?? '{}');
    expect(cache).toEqual({
      workspaceId: 'ws-B',
      projectId: 'proj-B',
      sessionId: 'sess-B',
    });
    const intent = JSON.parse(sessionStorage.getItem('adham:compose:create-intent') ?? '{}');
    expect(intent).toEqual({
      requestId: 'intent-B',
      workspaceId: 'ws-B',
      projectId: 'proj-B',
    });
  });
});
