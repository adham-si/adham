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
    };
  }

  it('retains New Session request identity across unknown outcome, reuses it on explicit retry, and blocks different creation while unresolved', async () => {
    const backend = createMockBackend();
    let attempt = 0;
    const capturedRequestIds: string[] = [];

    backend.createSession.mockImplementation(
      (_ws: string, _proj: string, _payload: unknown, opts?: { requestId?: string }) => {
        attempt += 1;
        if (opts?.requestId) capturedRequestIds.push(opts.requestId);
        if (attempt === 1) {
          // Unknown outcome: network timeout / response lost
          return Promise.reject(new Error('NETWORK_TIMEOUT: response lost'));
        }
        return Promise.resolve({
          sessionId: 'sess-recovered',
          projectId: 'proj-1',
          title: null,
          createdAt: new Date().toISOString(),
        });
      },
    );

    const { result, rerender } = renderHook(
      ({ ws, proj }) => useProjectSessions({ backend, workspaceId: ws, projectId: proj }),
      { initialProps: { ws: 'ws-1', proj: 'proj-1' } },
    );

    // Initial creation fails with unknown outcome
    await act(async () => {
      await result.current.newSession();
    });

    expect(capturedRequestIds).toHaveLength(1);
    const initialRequestId = capturedRequestIds[0];
    expect(result.current.error).toContain('NETWORK_TIMEOUT');

    // Attempting creation for a DIFFERENT project while unresolved is blocked
    rerender({ ws: 'ws-1', proj: 'proj-2' });
    await act(async () => {
      await result.current.newSession();
    });
    expect(result.current.error).toMatch(/another scope is pending resolution/i);
    expect(capturedRequestIds).toHaveLength(1); // blocked before createSession

    // Switch back to original target: explicit retry reuses the exact same requestId
    rerender({ ws: 'ws-1', proj: 'proj-1' });
    await act(async () => {
      await result.current.newSession();
    });

    expect(capturedRequestIds).toHaveLength(2);
    expect(capturedRequestIds[1]).toBe(initialRequestId);
  });

  it('clears unresolved intent on proven pre-effect rejection without blocking future creations', async () => {
    const backend = createMockBackend();
    backend.createSession.mockRejectedValueOnce('PROJECT_NOT_FOUND: stream does not exist');

    const { result, rerender } = renderHook(
      ({ ws, proj }) => useProjectSessions({ backend, workspaceId: ws, projectId: proj }),
      { initialProps: { ws: 'ws-1', proj: 'proj-1' } },
    );

    await act(async () => {
      await result.current.newSession();
    });

    expect(result.current.error).toContain('PROJECT_NOT_FOUND');

    // Since it was a proven pre-effect rejection, switching and creating a different session is NOT blocked
    rerender({ ws: 'ws-1', proj: 'proj-2' });
    await act(async () => {
      await result.current.newSession();
    });

    expect(result.current.error).toBeNull();
    expect(backend.createSession).toHaveBeenCalledTimes(2);
  });

  it('switch during post-create refresh cancels selection and announcement of created session', async () => {
    const backend = createMockBackend();
    let resolveRefresh!: (val: unknown) => void;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    let listCallCount = 0;
    backend.listSessions.mockImplementation(() => {
      listCallCount += 1;
      if (listCallCount === 2) {
        // Post-create refresh hangs until switch occurs
        return refreshPromise;
      }
      return Promise.resolve({
        sessions: [
          { sessionId: 'sess-b-1', title: 'Proj B session', createdAt: '2026-10-11T20:00:00Z' },
        ],
        truncated: false,
      });
    });

    const selectSpy = vi.fn();
    window.addEventListener('adham:session-select', selectSpy);

    const { result, rerender } = renderHook(
      ({ proj }) => useProjectSessions({ backend, workspaceId: 'ws-1', projectId: proj }),
      { initialProps: { proj: 'proj-A' } },
    );

    let createPromise: Promise<void>;
    act(() => {
      createPromise = result.current.newSession();
    });

    // Switch to project B while post-create refresh is in flight
    rerender({ proj: 'proj-B' });

    await act(async () => {
      resolveRefresh({
        sessions: [
          { sessionId: 'sess-a-created', title: 'New A', createdAt: '2026-10-11T20:01:00Z' },
        ],
        truncated: false,
      });
      await createPromise!;
    });

    // Created session from project A must not be selected or announced
    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.current.activeSessionId).toBeNull();
    window.removeEventListener('adham:session-select', selectSpy);
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

  it('overlapping newSession calls do not dispatch duplicate session creations', async () => {
    const backend = createMockBackend();
    let resolveCreate!: (val: unknown) => void;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    backend.createSession.mockImplementation(() => createPromise);
    backend.listSessions.mockResolvedValue({ sessions: [], truncated: false });

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    let p1: Promise<void>;
    act(() => {
      p1 = result.current.newSession();
    });

    act(() => {
      void result.current.newSession();
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({
        sessionId: 'sess-single',
        projectId: 'proj-1',
        title: null,
        createdAt: '2026-10-11T20:00:00Z',
      });
      await p1!;
    });

    expect(backend.createSession).toHaveBeenCalledTimes(1);
  });
});
