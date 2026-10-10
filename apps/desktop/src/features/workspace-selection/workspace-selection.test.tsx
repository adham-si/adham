import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelection } from './use-selection';
import { WorkspaceSelection } from './workspace-selection';
import { SCOPE_CHANGED_EVENT, readSelectIntent } from '../conversation/conversation-identity';

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
    listWorkspaces: vi.fn(async () => ({ workspaces: [WS], truncated: false })),
    listProjects: vi.fn(async (wsId: string) => ({
      workspaceId: wsId,
      projects: wsId === 'ws-1' ? [PROJ] : [],
      truncated: false,
    })),
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

  it('tracks workspaces whose project list failed', async () => {
    const backend = fakeSelection();
    backend.listProjects.mockRejectedValueOnce(new Error('read outage'));
    const { result } = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.failedProjectLists).toEqual(['ws-1']);
    expect(result.current.listError).toMatch(/retry/i);
    expect(result.current.projectsBy).toEqual({ 'ws-1': [] });
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
    const seen: Array<unknown> = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(SCOPE_CHANGED_EVENT, listener);
    try {
      const { result } = renderHook(() => useSelection({ backend }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await act(async () => {
        await result.current.select('ws-1', 'proj-1');
      });
      expect(seen).toEqual([
        {
          step: 'project',
          origin: 'selected',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
        },
      ]);
      expect(result.current.activeWorkspaceId).toBe('ws-1');
      expect(result.current.activeProjectId).toBe('proj-1');
    } finally {
      window.removeEventListener(SCOPE_CHANGED_EVENT, listener);
    }
  });

  it('synchronizes confirmed scope to instances that did not select', async () => {
    const backend = fakeSelection();
    const first = renderHook(() => useSelection({ backend }));
    const second = renderHook(() => useSelection({ backend }));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    const readsBefore = backend.getBootstrapState.mock.calls.length;
    await act(async () => {
      await first.result.current.select('ws-1', 'proj-1');
    });
    // The bystander applies the event-carried scope with no re-read.
    expect(second.result.current.activeWorkspaceId).toBe('ws-1');
    expect(second.result.current.activeProjectId).toBe('proj-1');
    expect(backend.getBootstrapState.mock.calls.length).toBe(readsBefore);
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
        truncatedWorkspaces={false}
        truncatedProjects={{}}
        failedWorkspaces={[]}
        activeWorkspaceId="ws-1"
        activeProjectId="proj-1"
        loading={false}
        listError={null}
        selectError={null}
        onSelectProject={onSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: /select workspace/i }));
    expect(screen.getByText('WS')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Proj' })).toBeDefined();
    expect(screen.getByText('No projects yet')).toBeDefined();
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    expect(onSelect).toHaveBeenCalledWith('ws-1', 'proj-1');
  });

  it('discloses truncated lists', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSelection
        workspaces={[WS]}
        projectsBy={{ 'ws-1': [PROJ] }}
        truncatedWorkspaces
        truncatedProjects={{ 'ws-1': true }}
        failedWorkspaces={[]}
        activeWorkspaceId={null}
        activeProjectId={null}
        loading={false}
        listError={null}
        selectError={null}
        onSelectProject={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /select workspace/i }));
    expect(screen.getByText('Showing first 100 workspaces')).toBeDefined();
    expect(screen.getByText('Showing first 100 projects')).toBeDefined();
  });
});
