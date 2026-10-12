import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from './conversation-panel';
import { ConversationSetupSlot, type ConversationSetupSlotProps } from './conversation-setup-slot';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function fakeBackend() {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      title: null,
      createdAt: '2026-10-09T00:00:00Z',
    }),
    submitMessage: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      text: 'hello backend',
      createdAt: '2026-10-09T00:00:01Z',
      streamSequence: '1',
      projectionPosition: '1',
    }),
    getConversation: vi.fn().mockResolvedValue({
      items: [
        {
          messageId: 'msg-0',
          role: 'user',
          text: 'earlier truth',
          createdAt: '2026-10-09T00:00:00Z',
          sourceEventId: 'evt-0',
        },
      ],
      nextCursor: null,
      projectionPosition: '1',
    }),
    listSessions: vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionId: 'sess-1',
          title: null,
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      truncated: false,
    }),
  };
}

describe('ConversationPanel', () => {
  it('shows backend history without any simulated agent text', async () => {
    render(<ConversationPanel backend={fakeBackend()} />);

    await waitFor(() => expect(screen.getByText('earlier truth')).toBeDefined());
    expect(screen.queryByText(/Analyzing prompt/i)).toBeNull();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('renders telemetry as unknown and discloses the model gap in production', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/model selection is not applied/i)).toBeDefined();
    expect(screen.queryByText(/12\.4k \/ 128k/)).toBeNull();
    expect(screen.queryByText(/adham\.si/)).toBeNull();
  });

  it('submits text and shows the backend-issued message while clearing the draft', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });

    await user.type(box, 'hello backend');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('hello backend')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('retains the draft and reports truthfully when submission fails', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    const box = (await screen.findByRole('textbox', {
      name: /composer input/i,
    })) as HTMLTextAreaElement;

    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());
    expect(box.value).toBe('unsaved words');
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /reload history/i })).toBeDefined();
  });

  it('marks execution unavailable in execute mode without any approval flow', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    expect(screen.queryByText(/execution.*unavailable|unavailable.*execution/i)).toBeNull();
    // Switch to execute mode via the mode radiogroup.
    await user.click(screen.getByRole('radio', { name: /execute/i }));

    expect(screen.getByText(/execution.*unavailable|unavailable.*execution/i)).toBeDefined();
    expect(screen.queryByText(/Verified sandbox execution/i)).toBeNull();
  });

  it('never renders a Stop button because no stop command exists', async () => {
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    await screen.findByRole('textbox', { name: /composer input/i });

    expect(screen.queryByRole('button', { name: /stop generation/i })).toBeNull();
  });

  it('discloses that pasted attachments are not transmitted', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });

    await user.click(box);
    await user.paste('A'.repeat(2500));

    expect(screen.getByText(/will not be sent/i)).toBeDefined();
  });

  it('reloads history from the error banner without resubmitting', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    backend.getConversation.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      projectionPosition: '0',
    });
    backend.submitMessage.mockRejectedValueOnce(new Error('IPC offline'));
    render(<ConversationPanel backend={backend} />);
    const box = await screen.findByRole('textbox', { name: /composer input/i });
    await user.type(box, 'unsaved words');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/IPC offline/i)).toBeDefined());

    backend.getConversation.mockResolvedValueOnce({
      items: [
        {
          messageId: 'msg-found',
          role: 'user',
          text: 'already saved',
          createdAt: '2026-10-09T00:00:03Z',
          sourceEventId: 'evt-9',
        },
      ],
      nextCursor: null,
      projectionPosition: '2',
    });
    await user.click(screen.getByRole('button', { name: /reload history/i }));

    await waitFor(() => expect(screen.getByText('already saved')).toBeDefined());
    expect(backend.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps text typed before the session is ready', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    let resolveBootstrap!: () => void;
    backend.getBootstrapState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = () =>
            resolve({
              isInitialized: true,
              activeWorkspaceId: 'ws-1',
              activeProjectId: 'proj-1',
            });
        }),
    );
    render(<ConversationPanel backend={backend} />);

    const box = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    await user.type(box, 'early thought');
    await act(async () => {
      resolveBootstrap();
    });
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('early thought'),
    );

    expect(box.value).toBe('early thought');
  });

  it('restores text typed before bootstrap across unmount and remount', async () => {
    const user = userEvent.setup();
    const backend = fakeBackend();
    // Bootstrap never resolves during the first mount.
    backend.getBootstrapState.mockImplementationOnce(() => new Promise(() => {}));
    const first = render(<ConversationPanel backend={backend} />);

    const box = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    await user.type(box, 'early thought');
    first.unmount();

    const secondBackend = fakeBackend();
    render(<ConversationPanel backend={secondBackend} />);
    const restored = screen.getByRole('textbox', {
      name: /composer input/i,
    }) as HTMLTextAreaElement;
    // Restored from the pending bucket on mount, and kept once the
    // resolved session adopts it.
    expect(restored.value).toBe('early thought');
    await waitFor(() =>
      expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('early thought'),
    );
    expect(restored.value).toBe('early thought');
  });

  it('never turns failed or unknown project discovery into an empty-project creation offer', async () => {
    const backend = fakeBackend();
    backend.getBootstrapState.mockResolvedValueOnce({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
    });
    const selection = {
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [
          {
            workspaceId: 'ws-1',
            name: 'WS 1',
            kind: 'personal',
            preferredLanguage: 'en',
            createdAt: '2026-10-09T00:00:00Z',
          },
        ],
        truncated: false,
      }),
      listProjects: vi.fn().mockRejectedValue(new Error('discovery outage')),
      selectProject: vi.fn(),
    };
    render(<ConversationPanel backend={backend} selection={selection} />);

    // Renders WorkspaceSelection error / retry notice, never the project creation form
    await screen.findByText(/failed to load.*retry/i);
    expect(screen.queryByLabelText(/project name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /create project/i })).toBeNull();
  });

  it('chosen-workspace discovery: not-yet-loaded and failed lists never offer creation; successful empty discovery permits creation', () => {
    const baseSel = {
      workspaces: [
        {
          workspaceId: 'ws-chosen',
          name: 'Chosen WS',
          kind: 'personal' as const,
          preferredLanguage: 'en',
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      projectsBy: {},
      truncatedWorkspaces: false,
      truncatedProjects: {},
      failedProjectLists: [] as string[],
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
      loaded: true,
      listError: null,
      selectScope: vi.fn(),
      reload: vi.fn(),
      reloadProjects: vi.fn(),
      reloadActiveProjects: vi.fn(),
      isSelecting: false,
      selectError: null,
      hasRecords: true,
      hasProjectsFor: vi.fn(),
      hasEverSelected: true,
    };
    const prov = {
      isCreatingWorkspace: false,
      isCreatingProject: false,
      workspaceError: null,
      projectError: null,
      createWorkspace: vi.fn(),
      createProject: vi.fn(),
    };

    const commonProps = {
      status: 'needs-workspace' as const,
      activeWorkspaceId: 'ws-1',
      provisionTransition: null,
      prov: prov as unknown as ConversationSetupSlotProps['prov'],
      formWorking: false,
      chosenWorkspaceId: 'ws-chosen',
      setChosenWorkspaceId: vi.fn(),
      onProvision: vi.fn(),
      onSelect: vi.fn(),
    };

    // 1. Not-yet-loaded chosen workspace: projectsBy has no entry for ws-chosen
    const notLoaded = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={baseSel as unknown as ConversationSetupSlotProps['sel']}
      />,
    );
    expect(notLoaded.queryByLabelText(/project name/i)).toBeNull();
    expect(notLoaded.queryByRole('button', { name: /create project/i })).toBeNull();
    notLoaded.unmount();

    // 2. Failed chosen workspace: failedProjectLists includes ws-chosen
    const failed = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={
          {
            ...baseSel,
            failedProjectLists: ['ws-chosen'],
            projectsBy: { 'ws-chosen': [] },
          } as unknown as ConversationSetupSlotProps['sel']
        }
      />,
    );
    expect(failed.queryByLabelText(/project name/i)).toBeNull();
    expect(failed.queryByRole('button', { name: /create project/i })).toBeNull();
    failed.unmount();

    // 3. Successful empty discovery: loaded, not failed, projectsBy confirmed empty array
    const emptySuccess = render(
      <ConversationSetupSlot
        {...commonProps}
        sel={
          {
            ...baseSel,
            failedProjectLists: [],
            projectsBy: { 'ws-chosen': [] },
          } as unknown as ConversationSetupSlotProps['sel']
        }
      />,
    );
    expect(emptySuccess.getByLabelText(/project name/i)).toBeDefined();
    expect(emptySuccess.getByRole('button', { name: /create project/i })).toBeDefined();
    expect(emptySuccess.getByText(/first project in chosen ws/i)).toBeDefined();
    emptySuccess.unmount();
  });
});
