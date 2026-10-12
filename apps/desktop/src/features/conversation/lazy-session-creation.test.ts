import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversation } from './use-conversation';
import { fakeBackend } from './conversation-test-utils';
import {
  readPendingFirstSend,
  writePendingFirstSend,
  removePendingFirstSend,
  type PendingFirstSend,
} from './lazy-session-creation';
import {
  readDurableSessionPreference,
  writeDurableSessionPreference,
} from './durable-session-storage';
import { readSessionCache } from './conversation-identity';
import { useProjectSessions } from './use-project-sessions';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lazy session creation regressions', () => {
  // Regression 1: Double-click/overlapping first sends
  it('prevents overlapping first sends with immediate in-flight guard', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    let resolveCreate!: (val: unknown) => void;
    backend.createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    let p1: Promise<unknown>;
    let p2: Promise<unknown>;
    act(() => {
      p1 = result.current.submit('double click message');
      p2 = result.current.submit('double click message');
    });

    const res2 = await p2!;
    expect(res2).toEqual({
      ok: false,
      error: 'A message is already being saved.',
      uncertain: false,
    });

    await act(async () => {
      resolveCreate({
        sessionId: 'sess-created-1',
        projectId: 'proj-1',
        title: null,
        createdAt: '2026-10-12T00:00:00Z',
      });
      await p1!;
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  // Regression 2: Scope switch while creation is pending
  it('fences creation when user switches scopes while first-send creation is pending', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-A',
    });
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });

    let resolveCreateA!: (val: unknown) => void;
    backend.createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreateA = resolve;
        }),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    let sendPromiseA: Promise<unknown>;
    act(() => {
      sendPromiseA = result.current.submit('scope A message');
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));

    // User switches to Project B before Scope A creation resolves
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-B',
    });
    backend.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'sess-B-1', title: null, createdAt: '2026-10-12T00:00:00Z' }],
      truncated: false,
    });
    await act(async () => {
      result.current.refreshScope();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.context?.projectId).toBe('proj-B');
    expect(result.current.context?.sessionId).toBe('sess-B-1');

    // Scope A creation resolves late
    let outcomeA: unknown;
    await act(async () => {
      resolveCreateA({
        sessionId: 'sess-A-late',
        projectId: 'proj-A',
        title: null,
        createdAt: '2026-10-12T00:00:01Z',
      });
      outcomeA = await sendPromiseA!;
    });

    expect(outcomeA).toEqual({
      ok: false,
      error: 'Session changed while sending.',
      uncertain: false,
    });
    // Never submitted message into old or new project
    expect(backend.submitMessage).not.toHaveBeenCalled();
    // Scope B context remains intact
    expect(result.current.context?.projectId).toBe('proj-B');
  });

  // Regression 3: Creation success followed by message failure (two-command limitation)
  it('creation-success/message-failure retry: retains created session on message failure and retries into it without creating second session', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    backend.createSession.mockResolvedValueOnce({
      sessionId: 'sess-two-command',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-12T00:00:00Z',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('NETWORK_TIMEOUT: save failed'));

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    let outcome1: unknown;
    await act(async () => {
      outcome1 = await result.current.submit('unsaved words');
    });

    expect(outcome1).toEqual({
      ok: false,
      error: expect.stringMatching(/message was not saved.*retry to save into this session/i),
      uncertain: true,
    });
    expect(backend.createSession).toHaveBeenCalledTimes(1);

    // Created session is retained in PendingFirstSend
    const pending = readPendingFirstSend();
    expect(pending?.sessionId).toBe('sess-two-command');
    expect(pending?.text).toBe('unsaved words');

    // Context adopted the created session ID so composer shows message not saved state
    expect(result.current.sessionId).toBe('sess-two-command');

    // Retry: explicit retry into the retained session without creating another session
    backend.submitMessage.mockResolvedValueOnce({
      messageId: 'msg-recovered',
      sessionId: 'sess-two-command',
      text: 'unsaved words',
      createdAt: '2026-10-12T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    });

    let outcome2: unknown;
    await act(async () => {
      outcome2 = await result.current.submit('unsaved words');
    });

    expect(outcome2).toEqual({ ok: true });
    // Exactly 1 session was created in total
    expect(backend.createSession).toHaveBeenCalledTimes(1);
    expect(backend.submitMessage).toHaveBeenCalledTimes(2);
    expect(backend.submitMessage.mock.calls[1]?.[2]).toBe('sess-two-command');
    // Pending record cleared on confirmed message save
    expect(readPendingFirstSend()).toBeNull();
  });

  // Regression 4: Remount recovery with frozen request identities
  it('remount recovery: preserves pending first send across unmount and reuses frozen identities on retry', async () => {
    const frozenRecord: PendingFirstSend = {
      createRequestId: 'req-c-frozen-1',
      messageRequestId: 'req-m-frozen-1',
      text: 'frozen first text',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: null,
    };
    writePendingFirstSend(frozenRecord);

    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });
    backend.createSession.mockResolvedValueOnce({
      sessionId: 'sess-recovered-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-12T00:00:00Z',
    });
    backend.submitMessage.mockResolvedValueOnce({
      messageId: 'msg-recovered-1',
      sessionId: 'sess-recovered-1',
      text: 'frozen first text',
      createdAt: '2026-10-12T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    });

    // Mount hook after remount
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/previous first-message save is pending resolution/i);

    // Retrying with the same payload succeeds and reuses frozen identities
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit('frozen first text');
    });

    expect(outcome).toEqual({ ok: true });
    expect(backend.createSession).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      { title: null },
      { requestId: 'req-c-frozen-1' },
    );
    expect(backend.submitMessage).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      'sess-recovered-1',
      { text: 'frozen first text' },
      { requestId: 'req-m-frozen-1' },
    );
    expect(readPendingFirstSend()).toBeNull();
  });

  // Regression 5: New Session while send is unresolved preserves pending operation and sidebar selection
  it('clicking New Session while a send is unresolved does not clear the pending operation or falsely clear confirmed sidebar selection', async () => {
    const unresolved: PendingFirstSend = {
      createRequestId: 'req-c-persist',
      messageRequestId: 'req-m-persist',
      text: 'important first thought',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-confirmed-1',
    };
    writePendingFirstSend(unresolved);

    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: 'sess-confirmed-1',
          projectId: 'proj-1',
          title: 'Confirmed Session',
          createdAt: '2026-10-12T00:00:00Z',
        },
      ],
      truncated: false,
    });

    const sessionsBackend = {
      listSessions: vi.fn(async () => ({
        sessions: [
          {
            sessionId: 'sess-confirmed-1',
            projectId: 'proj-1',
            title: 'Confirmed Session',
            createdAt: '2026-10-12T00:00:00Z',
          },
        ],
      })),
      createSession: backend.createSession,
    };

    const sidebarHook = renderHook(() =>
      useProjectSessions({
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        backend: sessionsBackend,
      }),
    );

    // Confirm session is active in sidebar
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('adham:session-active', {
          detail: { workspaceId: 'ws-1', projectId: 'proj-1', sessionId: 'sess-confirmed-1' },
        }),
      );
    });
    expect(sidebarHook.result.current.activeSessionId).toBe('sess-confirmed-1');

    // Click New Session while send is unresolved
    await act(async () => {
      await sidebarHook.result.current.newSession();
    });

    // 1. Error is reported
    expect(sidebarHook.result.current.error).toMatch(/first-message save is pending resolution/i);
    // 2. Confirmed sidebar selection is NOT falsely cleared to null
    expect(sidebarHook.result.current.activeSessionId).toBe('sess-confirmed-1');
    // 3. Pending operation in storage is NOT discarded
    expect(readPendingFirstSend()).toEqual(unresolved);

    // Cleanup
    removePendingFirstSend();
  });

  // Regression 6: New Session/open-session actions while a send is unresolved
  it('preserves unresolved first send across New Session, openSession, and remount', async () => {
    const unresolved: PendingFirstSend = {
      createRequestId: 'req-c-1',
      messageRequestId: 'req-m-1',
      text: 'important first thought',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-half-baked',
    };
    writePendingFirstSend(unresolved);

    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'sess-other', title: null, createdAt: '2026-10-12T00:00:00Z' }],
      truncated: false,
    });

    const { result, unmount } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/previous first-message save is pending resolution/i);

    // Open another session
    await act(async () => {
      await result.current.openSession('sess-other');
    });
    // Pending first send must NOT be discarded
    expect(readPendingFirstSend()).toEqual(unresolved);

    // Start New Session (unsaved conversation)
    await act(async () => {
      await result.current.openSession(null);
    });
    expect(readPendingFirstSend()).toEqual(unresolved);

    // Remount hook
    unmount();
    expect(readPendingFirstSend()).toEqual(unresolved);

    // Conflicting send with different text is blocked while unresolved
    const secondHook = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(secondHook.result.current.status).toBe('error'));
    let blocked: unknown;
    await act(async () => {
      blocked = await secondHook.result.current.submit('different text');
    });
    expect(blocked).toEqual({
      ok: false,
      error: expect.stringMatching(/previous first-message save is pending resolution/i),
      uncertain: true,
    });

    // Cleaning up
    removePendingFirstSend();
  });

  // Regression 5: Nonempty discovery with failed history reads
  it('treats nonempty discovery with failed history as actionable error rather than empty project', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValue({
      sessions: [
        { sessionId: 'sess-existing-corrupted', title: null, createdAt: '2026-10-12T00:00:00Z' },
      ],
      truncated: false,
    });
    backend.getConversation.mockRejectedValueOnce(new Error('DATABASE_CORRUPT: disk I/O error'));

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    // Did NOT mask failed history recovery as ready-no-session
    expect(result.current.sessionId).toBeNull();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/disk I\/O error/i);
    expect(backend.createSession).not.toHaveBeenCalled();

    // Recover on retry
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBe('sess-existing-corrupted');
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  // Regression 6: No cache/preference/history requests using null session ID
  it('never performs cache, durable preference, or history calls with a null session ID', async () => {
    const backend = fakeBackend();
    backend.listSessions.mockResolvedValueOnce({ sessions: [], truncated: false });

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBeNull();

    // Cache is not written for null session
    const cached = readSessionCache();
    expect(cached).toBeNull();

    // Durable preference is not written for null session
    const pref = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(pref).toBeNull();

    // getConversation was never called
    expect(backend.getConversation).not.toHaveBeenCalled();

    // createSession was never called
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  // Regression 7: Existing saved-session restoration remaining unchanged
  it('restores existing saved session without creating a new session', async () => {
    const backend = fakeBackend();
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-restored-stable',
    });
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
      installationId: 'inst-1',
    });
    backend.getConversation.mockResolvedValue({
      items: [
        {
          messageId: 'msg-stable',
          role: 'user',
          text: 'restored history',
          createdAt: '2026-10-12T00:00:00Z',
          sourceEventId: 'evt-1',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    });

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.sessionId).toBe('sess-restored-stable');
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.text).toBe('restored history');
  });
});
