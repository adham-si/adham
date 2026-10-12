import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from '../conversation/conversation-panel';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

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

  it('offers retry when the active workspace project list fails', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    state.activeWs = 'ws-9';
    backend.listProjects.mockRejectedValueOnce(new Error('read outage'));
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    // Failed is not empty: retry UI, never the creation form.
    await screen.findByRole('alert');
    expect(screen.queryByLabelText(/project name/i)).toBeNull();
    expect(backend.createProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Proj' }));
    await waitFor(() => expect(backend.selectProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
    expect(backend.createProject).not.toHaveBeenCalled();
  });

  it('chooses an empty workspace then creates its first project', async () => {
    const user = userEvent.setup();
    const { backend, state } = journeyBackend();
    state.projWs = null;
    render(<ConversationPanel backend={backend} provisioning={backend} selection={backend} />);

    async function openWorkspaceMenu() {
      await screen.findByRole('button', { name: /select workspace/i });
      await user.click(screen.getByRole('button', { name: /select workspace/i }));
      await screen.findByRole('menuitem', { name: /create first project/i });
    }

    await openWorkspaceMenu();
    expect(screen.queryByLabelText(/workspace name/i)).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: /create first project/i }));
    await screen.findByText(/first project in/i);
    expect(screen.queryByRole('button', { name: /select workspace/i })).toBeNull();

    // Back out works too.
    await user.click(screen.getByRole('button', { name: /all workspaces/i }));
    await openWorkspaceMenu();
    await user.click(screen.getByRole('menuitem', { name: /create first project/i }));
    await user.type(screen.getByLabelText(/project name/i), 'Proj');
    await user.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(backend.createProject).toHaveBeenCalledTimes(1));
    expect(backend.createProject).toHaveBeenCalledWith(
      'ws-9',
      { name: 'Proj', storageKind: 'isolated' },
      { requestId: expect.any(String) },
    );
    expect(backend.createWorkspace).not.toHaveBeenCalled();
    await waitFor(() => expect(backend.createSession).toHaveBeenCalledTimes(1));
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
