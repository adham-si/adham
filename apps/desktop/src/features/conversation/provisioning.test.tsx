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

function publicEnvelope(code: string, messageKey: string, retryable: boolean) {
  return {
    protocolVersion: 1,
    code,
    messageKey,
    retryable,
    correlationId: 'corr-1',
    fieldErrors: [],
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

  it('blocks a renamed fork while the first intent is unresolved', async () => {
    const backend = fakeProvisioning();
    backend.createWorkspace.mockRejectedValueOnce(new Error('transport lost'));
    const { result } = renderHook(() => useProvisioning({ backend }));
    let first!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      first = await result.current.createWorkspace('WS');
    });
    expect(first.ok).toBe(false);
    expect(first.uncertain).toBe(true);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    // A different name while the first outcome is unknown is blocked
    // without dispatch: no extra backend call.
    let blocked!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      blocked = await result.current.createWorkspace('Other');
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.uncertain).toBe(true);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    // Retrying the original input reuses the identical frozen identity.
    backend.createWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      name: 'WS',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-09T00:00:00Z',
    });
    let retried!: { ok: boolean };
    await act(async () => {
      retried = await result.current.createWorkspace('WS');
    });
    expect(retried.ok).toBe(true);
    const ids = requestIds(backend, 'createWorkspace');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ids[0]).toBe(ids[1]);
    expect(readWorkspaceIntent()).toBeNull();
  });

  it('clears the intent on a Rust-serialized InvalidRequest and allows correction', async () => {
    const backend = fakeProvisioning();
    // Shape-faithful Rust ErrorEnvelope: serde camelCase + PublicErrorCode
    // variant name (no rename_all), as produced by from_error_str for a
    // 121-scalar name.
    backend.createWorkspace.mockRejectedValueOnce(
      publicEnvelope('InvalidRequest', 'error.validationFailed', false),
    );
    const { result } = renderHook(() => useProvisioning({ backend }));
    let outcome!: { ok: boolean; uncertain?: boolean; error?: string };
    await act(async () => {
      outcome = await result.current.createWorkspace('n'.repeat(121));
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(String(outcome.error)).toMatch(/invalid|correct/i);
    expect(readWorkspaceIntent()).toBeNull();
    // A corrected name dispatches a NEW intent instead of staying frozen.
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
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('retains the intent on public storage/unknown envelopes', async () => {
    const backend = fakeProvisioning();
    backend.createWorkspace.mockRejectedValueOnce(
      publicEnvelope('StorageUnavailable', 'error.storageUnavailable', true),
    );
    const { result } = renderHook(() => useProvisioning({ backend }));
    let first!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      first = await result.current.createWorkspace('WS');
    });
    expect(first.ok).toBe(false);
    expect(first.uncertain).toBe(true);
    expect(readWorkspaceIntent()).not.toBeNull();
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
    expect(ids[0]).toBe(ids[1]);
  });

  it('blocks dispatch when the intent record cannot be written', async () => {
    const backend = fakeProvisioning();
    const { result } = renderHook(() => useProvisioning({ backend }));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    let outcome!: { ok: boolean; uncertain?: boolean; error?: string };
    await act(async () => {
      outcome = await result.current.createWorkspace('WS');
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(String(outcome.error)).toMatch(/identity could not be recorded/i);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(readWorkspaceIntent()).toBeNull();
    setItemSpy.mockRestore();
  });

  it('reuses the frozen identity across remount', async () => {
    const backend = fakeProvisioning();
    backend.createWorkspace.mockRejectedValueOnce(new Error('transport lost'));
    const first = renderHook(() => useProvisioning({ backend }));
    await act(async () => {
      await first.result.current.createWorkspace('WS');
    });
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    first.unmount();
    backend.createWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      name: 'WS',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-09T00:00:00Z',
    });
    const second = renderHook(() => useProvisioning({ backend }));
    await act(async () => {
      await second.result.current.createWorkspace('WS');
    });
    const ids = requestIds(backend, 'createWorkspace');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
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

  it('resumes a failed project in the same workspace without recreating it', async () => {
    const backend = fakeProvisioning();
    backend.createProject.mockRejectedValueOnce(new Error('transport lost'));
    const { result } = renderHook(() => useProvisioning({ backend }));
    await act(async () => {
      await result.current.createWorkspace('WS');
    });
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    let failed!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      failed = await result.current.createProject('Proj', 'ws-1');
    });
    expect(failed.ok).toBe(false);
    expect(failed.uncertain).toBe(true);
    // A frozen project intent must not transfer into another workspace.
    let cross!: { ok: boolean };
    await act(async () => {
      cross = await result.current.createProject('Proj', 'ws-other');
    });
    expect(cross.ok).toBe(false);
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    backend.createProject.mockResolvedValueOnce({
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      name: 'Proj',
      storageKind: 'isolated',
      createdAt: '2026-10-09T00:00:01Z',
    });
    await act(async () => {
      await result.current.createProject('Proj', 'ws-1');
    });
    const projIds = requestIds(backend, 'createProject');
    expect(projIds).toHaveLength(2);
    expect(projIds[0]).toBe(projIds[1]);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it('still treats legacy handler strings as definite', async () => {
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
});

describe('provisioning journey', () => {
  function journeyBackend() {
    const state = {
      wsCreated: false,
      projWs: null as string | null,
      activeWs: null as string | null,
      activeProj: null as string | null,
      failRefreshOnce: false,
      delayRefresh: null as Promise<unknown> | null,
    };
    const bootstrapNow = () =>
      state.activeWs == null
        ? { isInitialized: false, activeWorkspaceId: null, activeProjectId: null }
        : state.activeProj == null
          ? { isInitialized: true, activeWorkspaceId: state.activeWs, activeProjectId: null }
          : {
              isInitialized: true,
              activeWorkspaceId: state.activeWs,
              activeProjectId: state.activeProj,
            };
    const wsSummary = {
      workspaceId: 'ws-9',
      name: 'WS',
      kind: 'personal',
      preferredLanguage: 'en',
      createdAt: '2026-10-09T00:00:00Z',
    };
    const projSummary = {
      projectId: 'proj-9',
      workspaceId: 'ws-9',
      name: 'Proj',
      storageKind: 'isolated',
      createdAt: '2026-10-09T00:00:01Z',
    };
    const backend = {
      getBootstrapState: vi.fn(async () => {
        if (state.failRefreshOnce) {
          state.failRefreshOnce = false;
          throw new Error('read outage');
        }
        if (state.delayRefresh) {
          const pending = state.delayRefresh;
          state.delayRefresh = null;
          await pending;
        }
        return bootstrapNow();
      }),
      createWorkspace: vi.fn(async () => {
        state.wsCreated = true;
        state.activeWs = 'ws-9';
        return wsSummary;
      }),
      createProject: vi.fn(async (wsId: string) => {
        state.projWs = wsId;
        state.activeWs = wsId;
        state.activeProj = 'proj-9';
        return { ...projSummary, workspaceId: wsId };
      }),
      listWorkspaces: vi.fn(async () => ({
        workspaces: state.wsCreated ? [wsSummary] : [],
        truncated: false,
      })),
      listProjects: vi.fn(async (wsId: string) => ({
        workspaceId: wsId,
        projects: state.projWs === wsId ? [{ ...projSummary, workspaceId: wsId }] : [],
        truncated: false,
      })),
      selectProject: vi.fn(async (wsId: string, payload: { projectId: string }) => {
        state.activeWs = wsId;
        state.activeProj = payload.projectId;
        return {
          isInitialized: true,
          activeWorkspaceId: wsId,
          activeProjectId: payload.projectId,
        };
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
    return { backend, state };
  }

  function renderPanel(backend: ReturnType<typeof journeyBackend>['backend']) {
    return render(
      <ConversationPanel backend={backend} provisioning={backend} selection={backend} />,
    );
  }

  it('fresh UI creates workspace then project and reaches the conversation', async () => {
    const user = userEvent.setup();
    const { backend } = journeyBackend();
    renderPanel(backend);

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
    expect(backend.selectProject).not.toHaveBeenCalled();
  });

  it('holds the confirmed workspace while bootstrap loads and dispatches once', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    renderPanel(backend);

    await screen.findByText(/create your workspace/i);
    let resolveRefresh!: (value: unknown) => void;
    state.delayRefresh = new Promise((resolve) => {
      resolveRefresh = resolve as (value: unknown) => void;
    });
    await user.type(screen.getByLabelText(/workspace name/i), 'WS');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(backend.createWorkspace).toHaveBeenCalledTimes(1));
    // Held disabled while the authoritative read is in flight.
    const held = screen.getByRole('button', { name: /create workspace/i }) as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    await user.click(held);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRefresh(undefined);
    });
    await screen.findByText(/create your project/i);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it('retries the read after a post-creation bootstrap failure without recreating', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    renderPanel(backend);

    await screen.findByText(/create your workspace/i);
    state.failRefreshOnce = true;
    await user.type(screen.getByLabelText(/workspace name/i), 'WS');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(backend.createWorkspace).toHaveBeenCalledTimes(1));
    // Read failure after a committed creation: read-only retry, no creation.
    await screen.findByRole('button', { name: /retry loading/i });
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.createProject).not.toHaveBeenCalled();
    const readsBefore = backend.getBootstrapState.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /retry loading/i }));
    await screen.findByText(/create your project/i);
    expect(backend.getBootstrapState.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(backend.createWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('holds the confirmed project while bootstrap loads and dispatches once', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    state.wsCreated = true;
    state.activeWs = 'ws-9';
    renderPanel(backend);

    await screen.findByText(/create your project/i);
    let resolveRefresh!: (value: unknown) => void;
    state.delayRefresh = new Promise((resolve) => {
      resolveRefresh = resolve as (value: unknown) => void;
    });
    await user.type(screen.getByLabelText(/project name/i), 'Proj');
    await user.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(backend.createProject).toHaveBeenCalledTimes(1));
    expect(backend.createProject).toHaveBeenCalledWith(
      'ws-9',
      { name: 'Proj', storageKind: 'isolated' },
      { requestId: expect.any(String) },
    );
    // Held disabled while the authoritative read is in flight.
    const held = screen.getByRole('button', { name: /create project/i }) as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    await user.click(held);
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRefresh(undefined);
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
  });

  it('retries the read after a post-project bootstrap failure without recreating', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    state.wsCreated = true;
    state.activeWs = 'ws-9';
    renderPanel(backend);

    await screen.findByText(/create your project/i);
    state.failRefreshOnce = true;
    await user.type(screen.getByLabelText(/project name/i), 'Proj');
    await user.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(backend.createProject).toHaveBeenCalledTimes(1));
    // Read failure after a committed project: read-only retry, no creation.
    await screen.findByRole('button', { name: /retry loading/i });
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    const readsBefore = backend.getBootstrapState.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /retry loading/i }));
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.getBootstrapState.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(backend.createProject).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
  });
});
