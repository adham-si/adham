import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useProjectSessions } from './use-project-sessions';
import { useConversation } from './use-conversation';
import {
  writeDurableSessionPreference,
  readDurableSessionPreference,
} from './durable-session-storage';

describe('APP-WIRING-03/04: Session creation lifecycle and scope boundaries', () => {
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
        sessions: [{ sessionId: 'sess-1', title: 'Session 1', createdAt: '2026-10-11T20:00:00Z' }],
        truncated: false,
      }),
      createSession: vi.fn().mockImplementation((ws, proj, _payload, opts) =>
        Promise.resolve({
          sessionId: `sess-created-${opts?.requestId || 'default'}`,
          projectId: proj,
          title: null,
          createdAt: new Date().toISOString(),
        }),
      ),
      getConversation: vi.fn().mockResolvedValue({
        items: [],
      }),
      submitMessage: vi.fn().mockResolvedValue({
        messageId: 'msg-1',
        sessionId: 'sess-1',
        text: 'hello',
        createdAt: '2026-10-11T20:00:00Z',
      }),
      recordPendingOperation: vi.fn(),
      listPendingOperations: vi.fn().mockResolvedValue({ operations: [], truncated: false }),
      clearPendingOperation: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('newSession sets activeSessionId to null and creates zero persisted sessions', async () => {
    const backend = createMockBackend();
    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await act(async () => {
      await result.current.newSession();
    });

    expect(result.current.activeSessionId).toBeNull();
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  it('newSession dispatches adham:session-select with null sessionId', async () => {
    const backend = createMockBackend();
    const selectEvents: unknown[] = [];
    const onSelect = (e: Event) => {
      selectEvents.push((e as CustomEvent).detail);
    };
    window.addEventListener('adham:session-select', onSelect);

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await act(async () => {
      await result.current.newSession();
    });

    expect(selectEvents).toEqual([{ workspaceId: 'ws-1', projectId: 'proj-1', sessionId: null }]);
    window.removeEventListener('adham:session-select', onSelect);
  });

  it('switching scopes while in unsaved conversation keeps selection null for new scope', async () => {
    const backend = createMockBackend();
    const { result, rerender } = renderHook(
      ({ ws, proj }) => useProjectSessions({ backend, workspaceId: ws, projectId: proj }),
      { initialProps: { ws: 'ws-1', proj: 'proj-1' } },
    );

    await act(async () => {
      await result.current.newSession();
    });
    expect(result.current.activeSessionId).toBeNull();

    rerender({ ws: 'ws-1', proj: 'proj-2' });
    expect(result.current.activeSessionId).toBeNull();
    expect(backend.createSession).not.toHaveBeenCalled();
  });

  it('session events carry workspace/project identity and consumer ignores mismatched events', async () => {
    const backend = createMockBackend();
    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    // Event for a different project does not highlight selection
    act(() => {
      window.dispatchEvent(
        new CustomEvent('adham:session-active', {
          detail: { workspaceId: 'ws-1', projectId: 'proj-other', sessionId: 'sess-foreign' },
        }),
      );
    });
    expect(result.current.activeSessionId).toBeNull();

    // Event with matching workspace and project highlights selection
    act(() => {
      window.dispatchEvent(
        new CustomEvent('adham:session-active', {
          detail: { workspaceId: 'ws-1', projectId: 'proj-1', sessionId: 'sess-matching' },
        }),
      );
    });
    expect(result.current.activeSessionId).toBe('sess-matching');
  });

  it('invalidates durable preference only for explicitly missing/mismatched session and retains preference on other errors', async () => {
    const backend = createMockBackend();

    // Write durable preference
    writeDurableSessionPreference({
      installationId: 'inst-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      sessionId: 'sess-preferred',
    });

    // 1. Transient error: DATABASE_BUSY does NOT clear preference
    backend.getConversation.mockRejectedValueOnce(new Error('DATABASE_BUSY'));

    const { result, unmount } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    const prefAfterBusy = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    expect(prefAfterBusy?.sessionId).toBe('sess-preferred');
    unmount();

    // 2. Explicit SESSION_NOT_FOUND DOES invalidate preference
    backend.getConversation.mockRejectedValueOnce('SESSION_NOT_FOUND: stream does not exist');
    const { result: result2 } = renderHook(() => useConversation({ backend }));
    await waitFor(() => expect(result2.current.status).toBe('ready'));

    const prefAfterNotFound = readDurableSessionPreference('inst-1', 'ws-1', 'proj-1');
    // Preference was replaced or recovered with project session
    expect(prefAfterNotFound?.sessionId).toBe('sess-1');
  });

  it('deferred project A session listing resolves after switching to project B does not overwrite project B sessions', async () => {
    const backend = createMockBackend();
    let resolveA!: (val: unknown) => void;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });

    backend.listSessions.mockImplementation((ctx: { projectId: string }) => {
      if (ctx.projectId === 'proj-A') return promiseA;
      return Promise.resolve({
        sessions: [
          { sessionId: 'sess-B1', title: 'Session B1', createdAt: '2026-10-11T20:00:00Z' },
        ],
        truncated: false,
      });
    });

    const { result, rerender } = renderHook(
      ({ proj }) => useProjectSessions({ backend, workspaceId: 'ws-1', projectId: proj }),
      { initialProps: { proj: 'proj-A' } },
    );

    rerender({ proj: 'proj-B' });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0]?.id).toBe('sess-B1');

    await act(async () => {
      resolveA({
        sessions: [
          { sessionId: 'sess-A1', title: 'Session A1', createdAt: '2026-10-11T19:00:00Z' },
        ],
        truncated: false,
      });
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.id).toBe('sess-B1');
  });

  it('overlapping newSession calls do not dispatch any backend calls and leave activeSessionId null', async () => {
    const backend = createMockBackend();
    backend.listSessions.mockResolvedValue({ sessions: [], truncated: false });

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await act(async () => {
      await Promise.all([result.current.newSession(), result.current.newSession()]);
    });

    expect(backend.createSession).not.toHaveBeenCalled();
    expect(result.current.activeSessionId).toBeNull();
  });
});
