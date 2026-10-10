import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelection } from './use-selection';
import { WorkspaceSelection } from './workspace-selection';
import { SCOPE_CHANGED_EVENT, readSelectIntent } from '../conversation/conversation-identity';
import { ConversationPanel } from '../conversation/conversation-panel';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const WS = {
  workspaceId: 'ws-1',
  name: 'WS',
  kind: 'personal',
  preferredLanguage: 'en',
  createdAt: '2026-10-09T00:00:00Z',
};
const PROJ = {
  projectId: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Proj',
  storageKind: 'isolated',
  createdAt: '2026-10-09T00:00:01Z',
};

function fakeSelection() {
  const selected = { ws: null as string | null, proj: null as string | null };
  return {
    getBootstrapState: vi.fn(async () => ({
      isInitialized: selected.ws !== null,
      activeWorkspaceId: selected.ws,
      activeProjectId: selected.proj,
    })),
    listWorkspaces: vi.fn(async () => [WS]),
    listProjects: vi.fn(async (wsId: string) => (wsId === 'ws-1' ? [PROJ] : [])),
    selectProject: vi.fn(
      async (wsId: string, payload: { projectId: string }, _options?: unknown) => {
        selected.ws = wsId;
        selected.proj = payload.projectId;
        return {
          isInitialized: true,
          activeWorkspaceId: wsId,
          activeProjectId: payload.projectId,
        };
      },
    ),
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

function selectIds(backend: ReturnType<typeof fakeSelection>) {
  return backend.selectProject.mock.calls.map(
    (call) => (call[2] as { requestId?: string } | undefined)?.requestId,
  );
}

describe('useSelection', () => {
  it('loads lists on mount without dispatching any selection', async () => {
    const backend = fakeSelection();
    const { result } = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.workspaces).toEqual([WS]);
    expect(result.current.projectsBy).toEqual({ 'ws-1': [PROJ] });
    expect(result.current.hasRecords).toBe(true);
    expect(backend.selectProject).not.toHaveBeenCalled();
    expect(readSelectIntent()).toBeNull();
  });

  it('blocks a different scope while one selection is unresolved', async () => {
    const backend = fakeSelection();
    backend.selectProject.mockRejectedValueOnce(new Error('transport lost'));
    const { result } = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let first!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      first = await result.current.select('ws-1', 'proj-1');
    });
    expect(first.ok).toBe(false);
    expect(first.uncertain).toBe(true);
    expect(backend.selectProject).toHaveBeenCalledTimes(1);

    // A different scope is blocked without dispatch.
    let blocked!: { ok: boolean; uncertain?: boolean };
    await act(async () => {
      blocked = await result.current.select('ws-1', 'proj-2');
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.uncertain).toBe(true);
    expect(backend.selectProject).toHaveBeenCalledTimes(1);

    // The same scope retries with the frozen identity.
    backend.selectProject.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    });
    let retried!: { ok: boolean };
    await act(async () => {
      retried = await result.current.select('ws-1', 'proj-1');
    });
    expect(retried.ok).toBe(true);
    const ids = selectIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(readSelectIntent()).toBeNull();
  });

  it('clears a definite rejection and allows a new scope with a new identity', async () => {
    const backend = fakeSelection();
    backend.selectProject.mockRejectedValueOnce(
      publicEnvelope('ProjectNotFound', 'error.projectNotFound', false),
    );
    const { result } = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let failed!: { ok: boolean; uncertain?: boolean; error?: string };
    await act(async () => {
      failed = await result.current.select('ws-1', 'proj-1');
    });
    expect(failed.ok).toBe(false);
    expect(failed.uncertain).toBe(false);
    expect(readSelectIntent()).toBeNull();

    backend.selectProject.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-2',
    });
    await act(async () => {
      await result.current.select('ws-1', 'proj-2');
    });
    const ids = selectIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('retains the intent on storage envelopes and reuses it across remount', async () => {
    const backend = fakeSelection();
    backend.selectProject.mockRejectedValueOnce(
      publicEnvelope('StorageUnavailable', 'error.storageUnavailable', true),
    );
    const first = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await act(async () => {
      await first.result.current.select('ws-1', 'proj-1');
    });
    expect(readSelectIntent()).not.toBeNull();
    first.unmount();

    backend.selectProject.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    });
    const second = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    await act(async () => {
      await second.result.current.select('ws-1', 'proj-1');
    });
    const ids = selectIds(backend);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(readSelectIntent()).toBeNull();
  });

  it('shares the frozen intent across live instances', async () => {
    const backend = fakeSelection();
    let resolveSelect!: (value: unknown) => void;
    backend.selectProject.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSelect = resolve as (value: unknown) => void;
        }),
    );
    const first = renderHook(() => useSelection({ backend }));
    const second = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = first.result.current.select('ws-1', 'proj-1');
    });
    // The second instance sees the frozen intent: same scope reuses it,
    // a different scope is blocked without dispatch.
    let blocked!: { ok: boolean };
    await act(async () => {
      blocked = await second.result.current.select('ws-1', 'proj-2');
    });
    expect(blocked.ok).toBe(false);
    expect(backend.selectProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSelect({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
      });
      await pending;
    });
    expect(backend.selectProject).toHaveBeenCalledTimes(1);
    expect(readSelectIntent()).toBeNull();
  });

  it('announces confirmed selection for the conversation surface', async () => {
    const backend = fakeSelection();
    const seen: Array<{ step?: unknown; origin?: unknown }> = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent).detail as { step?: unknown; origin?: unknown });
    window.addEventListener(SCOPE_CHANGED_EVENT, listener);
    try {
      const { result } = renderHook(() => useSelection({ backend }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await act(async () => {
        await result.current.select('ws-1', 'proj-1');
      });
      expect(seen).toEqual([{ step: 'project', origin: 'selected' }]);
      expect(result.current.activeWorkspaceId).toBe('ws-1');
      expect(result.current.activeProjectId).toBe('proj-1');
    } finally {
      window.removeEventListener(SCOPE_CHANGED_EVENT, listener);
    }
  });
});

describe('selection journey', () => {
  function journeyBackend() {
    const state = {
      wsCreated: true,
      projWs: 'ws-9' as string | null,
      activeWs: null as string | null,
      activeProj: null as string | null,
      failRefreshOnce: false,
      delayRefresh: null as Promise<unknown> | null,
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
        return state.activeWs == null
          ? { isInitialized: false, activeWorkspaceId: null, activeProjectId: null }
          : state.activeProj == null
            ? { isInitialized: true, activeWorkspaceId: state.activeWs, activeProjectId: null }
            : {
                isInitialized: true,
                activeWorkspaceId: state.activeWs,
                activeProjectId: state.activeProj,
              };
      }),
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
      listWorkspaces: vi.fn(async () => (state.wsCreated ? [wsSummary] : [])),
      listProjects: vi.fn(async (wsId: string) =>
        state.projWs === wsId ? [{ ...projSummary, workspaceId: wsId }] : [],
      ),
      selectProject: vi.fn(
        async (wsId: string, payload: { projectId: string }, _options?: unknown) => {
          state.activeWs = wsId;
          state.activeProj = payload.projectId;
          return {
            isInitialized: true,
            activeWorkspaceId: wsId,
            activeProjectId: payload.projectId,
          };
        },
      ),
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

  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('button', { name: /select workspace/i });
    await user.click(screen.getByRole('button', { name: /select workspace/i }));
    await screen.findByRole('menuitem', { name: 'Proj' });
  }

  it('offers existing records for selection instead of provisioning', async () => {
    const user = userEvent.setup();
    const { backend } = journeyBackend();
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    await openMenu(user);
    expect(screen.getByText('WS')).toBeDefined();
    expect(screen.queryByLabelText(/workspace name/i)).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.selectProject).toHaveBeenCalledTimes(1));
    expect(backend.selectProject).toHaveBeenCalledWith(
      'ws-9',
      { projectId: 'proj-9' },
      { requestId: expect.any(String) },
    );
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('keeps scope on failed selection and allows a corrected retry', async () => {
    const user = userEvent.setup();
    const { backend } = journeyBackend();
    backend.selectProject.mockRejectedValueOnce(
      publicEnvelope('ProjectNotFound', 'error.projectNotFound', false),
    );
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    // Scope unchanged: selection still offered, no creation dispatched.
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
    expect(backend.createSession).not.toHaveBeenCalled();

    // The definite rejection spent its identity: the retry mints a new one
    // and the stateful backend advances the authoritative scope.
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.selectProject).toHaveBeenCalledTimes(2));
    const ids = backend.selectProject.mock.calls.map(
      (call) => (call[2] as { requestId?: string } | undefined)?.requestId,
    );
    expect(ids[0]).not.toBe(ids[1]);
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
  });

  it('holds a confirmed selection while bootstrap loads and dispatches once', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    await openMenu(user);
    let resolveRefresh!: (value: unknown) => void;
    state.delayRefresh = new Promise((resolve) => {
      resolveRefresh = resolve as (value: unknown) => void;
    });
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.selectProject).toHaveBeenCalledTimes(1));
    // Held disabled while the authoritative read is in flight.
    const held = screen.getByRole('button', {
      name: /select workspace/i,
    }) as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    await act(async () => {
      resolveRefresh(undefined);
    });
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.selectProject).toHaveBeenCalledTimes(1);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('retries the read after a post-selection bootstrap failure without reselecting', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    await openMenu(user);
    state.failRefreshOnce = true;
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.selectProject).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: /retry loading/i });
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
    const readsBefore = backend.getBootstrapState.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /retry loading/i }));
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.getBootstrapState.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(backend.selectProject).toHaveBeenCalledTimes(1);
  });

  it('offers a read-only retry when the first list load fails', async () => {
    const user = userEvent.setup();
    const { backend } = journeyBackend();
    backend.listWorkspaces.mockRejectedValueOnce(new Error('read outage'));
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    await screen.findByRole('alert');
    // No creation form: a read failure must not invite duplicate creation.
    expect(screen.queryByLabelText(/workspace name/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    await openMenu(user);
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('restores the selected scope across remount', async () => {
    const user = userEvent.setup();
    const { backend } = journeyBackend();
    const first = render(
      <ConversationPanel backend={backend} provisioning={backend} selection={backend} />,
    );
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });
    expect(screen.queryByRole('button', { name: /select workspace/i })).toBeNull();
    expect(backend.selectProject).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceSelection', () => {
  it('renders workspace groups with their projects and marks the active one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <WorkspaceSelection
        workspaces={[WS, { ...WS, workspaceId: 'ws-2', name: 'Other' }]}
        projectsBy={{ 'ws-1': [PROJ] }}
        activeWorkspaceId="ws-1"
        activeProjectId="proj-1"
        loading={false}
        listError={null}
        selectError={null}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: /select workspace/i }));
    expect(screen.getByText('WS')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Proj' })).toBeDefined();
    expect(screen.getByText('No projects yet')).toBeDefined();
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    expect(onSelect).toHaveBeenCalledWith('ws-1', 'proj-1');
  });
});
