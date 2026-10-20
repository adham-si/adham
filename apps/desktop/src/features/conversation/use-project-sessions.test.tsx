import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectSessions } from './use-project-sessions';

function mockSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1',
    projectId: 'proj-1',
    title: 'First',
    createdAt: '2026-10-20T10:00:00Z',
    lastActivityAt: '2026-10-20T11:00:00Z',
    summary: 'First question — Latest answer',
    summaryOrigin: 'auto',
    summaryUnavailable: false,
    pinned: true,
    archived: false,
    ...overrides,
  };
}

describe('useProjectSessions history contract', () => {
  it('maps last activity, summary, pin, archive, and unreadable count', async () => {
    const backend = {
      listSessions: vi.fn().mockResolvedValue({
        projectId: 'proj-1',
        sessions: [mockSession({ archived: true })],
        truncated: false,
        unreadableSummaries: 1,
      }),
      createSession: vi.fn(),
    };

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    const row = result.current.sessions[0]!;
    expect(row.updatedAt).toBe('2026-10-20T11:00:00Z');
    expect(row.summary).toBe('First question — Latest answer');
    expect(row.pinned).toBe(true);
    expect(row.archived).toBe(true);
    expect(result.current.unreadableSummaries).toBe(1);
  });

  it('falls back to createdAt for old rows and passes the active session id', async () => {
    const backend = {
      listSessions: vi.fn().mockResolvedValue({
        projectId: 'proj-1',
        sessions: [mockSession({ lastActivityAt: '' })],
        truncated: false,
      }),
      createSession: vi.fn(),
    };

    const { result } = renderHook(() =>
      useProjectSessions({ backend, workspaceId: 'ws-1', projectId: 'proj-1' }),
    );
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0]!.updatedAt).toBe('2026-10-20T10:00:00Z');
    expect(backend.listSessions).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('adham:session-active', {
          detail: { workspaceId: 'ws-1', projectId: 'proj-1', sessionId: 'sess-1' },
        }),
      );
    });

    await waitFor(() =>
      expect(backend.listSessions).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        activeSessionId: 'sess-1',
      }),
    );
  });
});
