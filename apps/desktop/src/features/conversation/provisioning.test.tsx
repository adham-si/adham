import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProvisioning } from './use-provisioning';
import { readWorkspaceIntent } from './conversation-identity';
import { ConversationPanel } from './conversation-panel';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function fakeProvisioning() {
  return {
    createWorkspace: vi.fn().mockResolvedValue({
      workspaceId: 'ws-1',
      name: 'WS',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-09T00:00:00Z',
    }),
    createProject: vi.fn().mockResolvedValue({
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      name: 'Proj',
      storageKind: 'isolated',
      createdAt: '2026-10-09T00:00:01Z',
    }),
  };
}

function requestIds(
  backend: ReturnType<typeof fakeProvisioning>,
  method: 'createWorkspace' | 'createProject',
) {
  return backend[method].mock.calls.map(
    (call) => (call[1] as { requestId?: string } | undefined)?.requestId,
  );
}

describe('useProvisioning', () => {
  it('dispatches nothing on mount', () => {
    const backend = fakeProvisioning();
    renderHook(() => useProvisioning({ backend }));
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('freezes the intent before dispatch and clears it on success', async () => {
    const backend = fakeProvisioning();
    const { result } = renderHook(() => useProvisioning({ backend }));
    let outcome!: { ok: boolean };
    await act(async () => {
      outcome = await result.current.createWorkspace('WS');
    });
    expect(outcome.ok).toBe(true);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).toHaveBeenCalledWith(
      { name: 'WS', kind: 'personal', preferredLanguage: 'en' },
      { requestId: expect.any(String) },
    );
    expect(result.current.workspaceId).toBe('ws-1');
    expect(readWorkspaceIntent()).toBeNull();
  });

  it('reuses the same request ID on uncertain retry and blocks a renamed fork', async () => {
    const backend = fakeProvisioning();
    backend.createWorkspace.mockRejectedValueOnce(new Error('transport lost'));
    const { result } = renderHook(() => useProvisioning({ backend }));
    let first!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      first = await result.current.createWorkspace('WS');
    });
    expect(first.ok).toBe(false);
    // Same name retries with the identical frozen identity.
    backend.createWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      name: 'WS',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-09T00:00:00Z',
    });
    await act(async () => {
      await result.current.createWorkspace('WS');
    });
    const ids = requestIds(backend, 'createWorkspace');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ids[0]).toBe(ids[1]);
    // A different name while the first outcome is unknown is blocked.
    backend.createWorkspace.mockRejectedValueOnce(new Error('transport lost'));
    let blocked!: { ok: boolean };
    await act(async () => {
      blocked = await result.current.createWorkspace('Other');
    });
    expect(blocked.ok).toBe(false);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(3);
  });

  it('clears the intent on definite rejection and reports the message', async () => {
    const backend = fakeProvisioning();
    backend.createWorkspace.mockRejectedValueOnce({
      code: 'VALIDATION_FAILED',
      message: 'VALIDATION_FAILED: unsupported workspace kind',
    });
    const { result } = renderHook(() => useProvisioning({ backend }));
    let outcome!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      outcome = await result.current.createWorkspace('WS');
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(readWorkspaceIntent()).toBeNull();
  });

  it('binds project creation to the issued workspace and resumes there', async () => {
    const backend = fakeProvisioning();
    const { result } = renderHook(() => useProvisioning({ backend }));
    await act(async () => {
      await result.current.createWorkspace('WS');
    });
    let outcome!: { ok: boolean };
    await act(async () => {
      outcome = await result.current.createProject('Proj', result.current.workspaceId);
    });
    expect(outcome.ok).toBe(true);
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    expect(backend.createProject).toHaveBeenCalledWith(
      'ws-1',
      { name: 'Proj', storageKind: 'isolated' },
      { requestId: expect.any(String) },
    );
  });
});

describe('provisioning journey', () => {
  function journeyBackend() {
    return {
      getBootstrapState: vi
        .fn()
        .mockResolvedValueOnce({
          isInitialized: false,
          activeWorkspaceId: null,
          activeProjectId: null,
        })
        .mockResolvedValueOnce({
          isInitialized: true,
          activeWorkspaceId: 'ws-9',
          activeProjectId: null,
        })
        .mockResolvedValue({
          isInitialized: true,
          activeWorkspaceId: 'ws-9',
          activeProjectId: 'proj-9',
        }),
      createWorkspace: vi.fn().mockResolvedValue({
        workspaceId: 'ws-9',
        name: 'WS',
        kind: 'personal',
        preferredLanguage: 'en',
        createdAt: '2026-10-09T00:00:00Z',
      }),
      createProject: vi.fn().mockResolvedValue({
        projectId: 'proj-9',
        workspaceId: 'ws-9',
        name: 'Proj',
        storageKind: 'isolated',
        createdAt: '2026-10-09T00:00:01Z',
      }),
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'sess-9',
        projectId: 'proj-9',
        title: null,
        createdAt: '2026-10-09T00:00:02Z',
      }),
      submitMessage: vi.fn(),
      getConversation: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        projectionPosition: '0',
      }),
    };
  }

  it('fresh UI creates workspace then project and reaches the conversation', async () => {
    const user = userEvent.setup();
    const backend = journeyBackend();
    render(<ConversationPanel backend={backend} provisioning={backend} />);

    await screen.findByText(/create your workspace/i);
    const wsBox = screen.getByLabelText(/workspace name/i);
    await user.type(wsBox, 'WS');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(backend.createWorkspace).toHaveBeenCalledTimes(1));
    expect(backend.createWorkspace).toHaveBeenCalledWith(
      { name: 'WS', kind: 'personal', preferredLanguage: 'en' },
      { requestId: expect.any(String) },
    );

    await screen.findByText(/create your project/i);
    const projBox = screen.getByLabelText(/project name/i);
    await user.type(projBox, 'Proj');
    await user.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(backend.createProject).toHaveBeenCalledTimes(1));
    expect(backend.createProject).toHaveBeenCalledWith(
      'ws-9',
      { name: 'Proj', storageKind: 'isolated' },
      { requestId: expect.any(String) },
    );

    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/create your project/i)).toBeNull();
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
  });
});
