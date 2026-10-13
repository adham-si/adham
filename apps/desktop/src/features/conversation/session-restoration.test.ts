import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConversation } from './use-conversation';
import {
  writeDurableSessionPreference,
  readDurableSessionPreference,
} from './durable-session-storage';
import { announceScopeChanged } from './conversation-identity';
import { useProjectSessions } from './use-project-sessions';

describe('APP-WIRING-03/04: Session restoration and recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function createMockBackend() {
    return {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
        installationId: 'inst-1',
      }),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          { sessionId: 'sess-existing-2', title: 'Second', createdAt: '2026-10-11T20:00:00Z' },
          { sessionId: 'sess-existing-1', title: 'First', createdAt: '2026-10-11T19:00:00Z' },
        ],
      }),
      createSession: vi.fn().mockImplementation((ws, proj) =>
        Promise.resolve({
          sessionId: `sess-created-${Date.now()}`,
          projectId: proj,
          title: null,
          createdAt: new Date().toISOString(),
        }),
      ),
      submitMessage: vi.fn().mockResolvedValue({
        messageId: 'msg-1',
        sessionId: 'sess-1',
        text: 'hello',
        createdAt: new Date().toISOString(),
      }),
      getConversation: vi.fn().mockImplementation((ws, proj, sessId) =>
        Promise.resolve({
          items: [
            {
              messageId: `msg-for-${sessId}`,
              role: 'user',
              text: `Canary message in ${sessId}`,
              createdAt: '2026-10-11T20:05:00Z',
              sourceEventId: 'evt-1',
            },
          ],
        }),
      ),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('existing-session recovery: automatically discovers and opens most recent session when no durable entry exists', async () => {
    const backend = createMockBackend();

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Did not create an unnecessary replacement session
    expect(backend.createSession).not.toHaveBeenCalled();
    // Discovered existing sessions and picked the most recent one
    expect(backend.listSessions).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });
    expect(result.current.sessionId).toBe('sess-existing-2');
    // Loaded its existing conversation history
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.text).toBe('Canary message in sess-existing-2');

    // Recorded as durable preference for this installation/workspace/project
    const stored = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(stored?.sessionId).toBe('sess-existing-2');
  });

  it('durable restart: reopens the last selected session across a full restart', async () => {
    const backend = createMockBackend();

    // Pre-seed durable preference from a prior session
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-existing-1',
    });

    // Simulate native app launch / reopen
    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Resumed the exact preferred session
    expect(result.current.sessionId).toBe('sess-existing-1');
    expect(backend.getConversation).toHaveBeenCalledWith('ws-1', 'proj-1', 'sess-existing-1');
    expect(result.current.messages[0]?.text).toBe('Canary message in sess-existing-1');
    // No new session was minted
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  it('switching projects and back restores each project’s selected session', async () => {
    const backend = createMockBackend();

    // Project 1 has selected sess-p1
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-p1',
    });
    // Project 2 has selected sess-p2
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-2',
      sessionId: 'sess-p2',
    });

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBe('sess-p1');

    // Switch authoritative project to proj-2
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-2',
      installationId: 'inst-1',
    });

    act(() => {
      announceScopeChanged('project', 'selected', { workspaceId: 'ws-1', projectId: 'proj-2' });
      result.current.refreshScope();
    });

    await waitFor(() => expect(result.current.sessionId).toBe('sess-p2'));
    expect(result.current.messages[0]?.text).toBe('Canary message in sess-p2');

    // Switch back to proj-1
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
      installationId: 'inst-1',
    });

    act(() => {
      announceScopeChanged('project', 'selected', { workspaceId: 'ws-1', projectId: 'proj-1' });
      result.current.refreshScope();
    });

    await waitFor(() => expect(result.current.sessionId).toBe('sess-p1'));
    expect(result.current.messages[0]?.text).toBe('Canary message in sess-p1');
  });

  it('failed history read offers retry without creating a replacement session', async () => {
    const backend = createMockBackend();

    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-existing-1',
    });

    // Transient failure on initial read
    backend.getConversation.mockRejectedValueOnce(
      new Error('STORAGE_UNAVAILABLE: database locked'),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    // Did NOT create a replacement session
    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Retry once connectivity returns');

    // Retry succeeds
    backend.getConversation.mockResolvedValueOnce({
      items: [{ messageId: 'm1', role: 'user', text: 'Canary after retry', createdAt: '2026' }],
    });

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.sessionId).toBe('sess-existing-1');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.text).toContain('Canary');
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  it('invalid selection preference (SESSION_NOT_FOUND or CONTEXT_MISMATCH) clears preference and recovers existing session', async () => {
    const backend = createMockBackend();

    // Write a stale/foreign session ID
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-stale-foreign',
    });

    // Backend rejects with CONTEXT_MISMATCH
    backend.getConversation.mockImplementationOnce(() =>
      Promise.reject('CONTEXT_MISMATCH: session does not belong to specified project'),
    );

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Invalid preference was replaced by existing project session recovery
    expect(result.current.sessionId).toBe('sess-existing-2');
    const updatedPref = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(updatedPref?.sessionId).toBe('sess-existing-2');
  });

  it('new session starts an unsaved conversation and creates zero persisted sessions before a send', async () => {
    const backend = createMockBackend();
    const sessions: Array<{ sessionId: string; title: string | null; createdAt: string }> = [
      { sessionId: 'sess-1', title: 'First', createdAt: '2026-10-11T19:00:00Z' },
    ];
    backend.listSessions.mockImplementation(() =>
      Promise.resolve({ sessions: [...sessions], truncated: false }),
    );

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    const selectEvents: unknown[] = [];
    const onSelect = (e: Event) => {
      const custom = e as CustomEvent<{
        workspaceId: string;
        projectId: string;
        sessionId: string | null;
      }>;
      selectEvents.push(custom.detail);
    };
    window.addEventListener('adham:session-select', onSelect);

    await act(async () => {
      await result.current.newSession();
    });

    // Zero backend sessions were created
    expect(backend.createSession).not.toHaveBeenCalled();
    // Selection set to null (unsaved conversation)
    expect(result.current.activeSessionId).toBeNull();
    // Session list unchanged
    expect(result.current.sessions).toHaveLength(1);
    // Announced session-select event with sessionId: null
    expect(selectEvents).toEqual([{ workspaceId: 'ws-1', projectId: 'proj-1', sessionId: null }]);
    window.removeEventListener('adham:session-select', onSelect);
  });

  it('session-list failures offer retry, not an empty-success state', async () => {
    const backend = createMockBackend();
    backend.listSessions.mockRejectedValueOnce(new Error('DATABASE_BUSY'));

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await waitFor(() => expect(result.current.error).toBe('DATABASE_BUSY'));
    expect(result.current.sessions).toHaveLength(0);

    // Retry recovers the list
    backend.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'sess-1', title: 'Recovered', createdAt: '2026-10-11T20:00:00Z' }],
      truncated: false,
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.title).toBe('Recovered');
  });

  it('bounded lists reflect visible truncation indicator', async () => {
    const backend = createMockBackend();
    backend.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'sess-1', title: 'Session 1', createdAt: '2026-10-11T20:00:00Z' }],
      truncated: true,
    });

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await waitFor(() => expect(result.current.truncated).toBe(true));
  });

  it('unavailable durable storage produces a visible warning', async () => {
    const backend = createMockBackend();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QUOTA_EXCEEDED');
    });

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.storageWarning).not.toBeNull());
    expect(result.current.storageWarning).toMatch(/durable session storage is unavailable/i);
  });

  it('rejected session discovery (e.g. PROJECT_NOT_FOUND or CONTEXT_MISMATCH) returns error and performs zero session creation', async () => {
    const backend = createMockBackend();
    backend.listSessions.mockRejectedValueOnce('PROJECT_NOT_FOUND: project stream does not exist');

    const { result } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toContain('PROJECT_NOT_FOUND');
  });
});
