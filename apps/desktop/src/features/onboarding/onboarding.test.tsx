import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOnboarding, type UseOnboardingOptions } from './model/use-onboarding';
import { OnboardingJourney } from './ui/onboarding-journey';
import type { SelectionBackend } from '../workspace-selection';
import i18n from '@/shared/i18n';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  // Language tests switch the shared i18n singleton; reset for isolation.
  await i18n.changeLanguage('en');
});

function fakeSelection(overrides: Partial<SelectionBackend> = {}) {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      isInitialized: false,
      activeWorkspaceId: null,
      activeProjectId: null,
    }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [], truncated: false }),
    listProjects: vi.fn().mockResolvedValue({ projects: [], truncated: false }),
    selectProject: vi.fn().mockResolvedValue({
      isInitialized: true,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    }),
    ...overrides,
  };
}

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

function fakePlatform(status = 'ready') {
  return { getStorageStatus: vi.fn().mockResolvedValue({ status }) };
}

async function renderReadyHook(options: UseOnboardingOptions) {
  const view = renderHook(() => useOnboarding(options));
  await waitFor(() => expect(view.result.current.phase).not.toBe('checking'));
  return view;
}

describe('useOnboarding', () => {
  it('dispatches nothing on mount', () => {
    const selection = fakeSelection();
    const provisioning = fakeProvisioning();
    renderHook(() => useOnboarding({ selection, provisioning, platform: fakePlatform() }));
    expect(provisioning.createWorkspace).not.toHaveBeenCalled();
    expect(provisioning.createProject).not.toHaveBeenCalled();
    expect(selection.selectProject).not.toHaveBeenCalled();
  });

  it('shows setup at the workspace step on a fresh install', async () => {
    const { result } = await renderReadyHook({
      selection: fakeSelection(),
      provisioning: fakeProvisioning(),
      platform: fakePlatform(),
    });
    expect(result.current.phase).toBe('setup');
    expect(result.current.step).toBe('workspace');
  });

  it('resumes an interrupted workspace-without-project setup at the project step', async () => {
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [{ workspaceId: 'ws-1', name: 'Resume WS' }],
        truncated: false,
      }),
    });
    const { result } = await renderReadyHook({
      selection,
      provisioning: fakeProvisioning(),
      platform: fakePlatform(),
    });
    expect(result.current.phase).toBe('setup');
    expect(result.current.step).toBe('project');
    expect(result.current.target).toMatchObject({
      workspaceId: 'ws-1',
      workspaceName: 'Resume WS',
    });
  });

  it('bypasses setup for a fully provisioned returning install', async () => {
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'proj-1',
      }),
    });
    const { result } = await renderReadyHook({
      selection,
      provisioning: fakeProvisioning(),
      platform: fakePlatform(),
    });
    expect(result.current.phase).toBe('complete');
  });

  it('surfaces a failed state read as an error phase, not an empty setup', async () => {
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockRejectedValue(new Error('ipc down')),
      listWorkspaces: vi.fn().mockRejectedValue(new Error('ipc down')),
    });
    const { result } = await renderReadyHook({
      selection,
      provisioning: fakeProvisioning(),
      platform: fakePlatform(),
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.listError).toBe('ipc down');
  });

  it('blocks the journey on a degraded storage status with a retry', async () => {
    const platform = fakePlatform('degraded');
    const { result } = await renderReadyHook({
      selection: fakeSelection(),
      provisioning: fakeProvisioning(),
      platform,
    });
    expect(result.current.blocker).toBe('storage-degraded');
    platform.getStorageStatus.mockResolvedValue({ status: 'ready' });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.blocker).toBeNull());
  });

  it('blocks setup with an unavailable state when the readiness read fails', async () => {
    const platform = { getStorageStatus: vi.fn().mockRejectedValue(new Error('status lost')) };
    const provisioning = fakeProvisioning();
    const { result } = await renderReadyHook({
      selection: fakeSelection(),
      provisioning,
      platform,
    });
    expect(result.current.blocker).toBe('storage-unavailable');
    // Fail-closed at the model, not just the UI: no mutation dispatches.
    await act(async () => result.current.createWorkspace('Blocked WS'));
    expect(provisioning.createWorkspace).not.toHaveBeenCalled();
    // Recovery: an explicit ready reopens setup. (blocker is also null while
    // the re-read is in flight, so require the setup phase as well.)
    platform.getStorageStatus.mockResolvedValue({ status: 'ready' });
    act(() => result.current.retry());
    await waitFor(() => {
      expect(result.current.phase).toBe('setup');
      expect(result.current.blocker).toBeNull();
    });
    await act(async () => result.current.createWorkspace('Allowed WS'));
    expect(provisioning.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it('treats an unrecognized readiness status as unavailable, never as ready', async () => {
    const { result } = await renderReadyHook({
      selection: fakeSelection(),
      provisioning: fakeProvisioning(),
      platform: fakePlatform('something-new'),
    });
    expect(result.current.blocker).toBe('storage-unavailable');
  });

  it('dispatches nothing from any mutation while a readiness re-read is pending, even with blocker null', async () => {
    let release!: (value: { status: string }) => void;
    const platform = {
      getStorageStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: 'ready' })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        ),
    };
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [{ workspaceId: 'ws-1', name: 'Resume WS' }],
        truncated: false,
      }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ projectId: 'proj-1', name: 'Resume Proj' }],
        truncated: false,
      }),
    });
    const provisioning = fakeProvisioning();
    const { result } = await renderReadyHook({ selection, provisioning, platform });
    expect(result.current.step).toBe('project');
    await waitFor(() => expect(result.current.projects).not.toBeNull());
    act(() => result.current.chooseProject('proj-1'));
    expect(result.current.selectedProjectId).toBe('proj-1');

    // Retry re-enters the transient checking state. blocker === null there,
    // and blocker === null must never mean "safe to proceed".
    act(() => result.current.retry());
    await waitFor(() => expect(platform.getStorageStatus).toHaveBeenCalledTimes(2));
    expect(result.current.phase).toBe('checking');
    expect(result.current.blocker).toBeNull();

    await act(async () => {
      await result.current.createWorkspace('Blocked WS');
      await result.current.createProject('Blocked Proj');
      await result.current.confirmProject();
    });
    expect(provisioning.createWorkspace).not.toHaveBeenCalled();
    expect(provisioning.createProject).not.toHaveBeenCalled();
    expect(selection.selectProject).not.toHaveBeenCalled();

    // Only an explicit ready reopens the mutations.
    await act(async () => {
      release({ status: 'ready' });
    });
    await waitFor(() => expect(result.current.phase).toBe('setup'));
    await act(async () => result.current.confirmProject());
    expect(selection.selectProject).toHaveBeenCalledTimes(1);
  });

  it('reports a failed project list as failure, never as empty', async () => {
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockResolvedValue({
        isInitialized: true,
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      }),
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [{ workspaceId: 'ws-1', name: 'WS' }],
        truncated: false,
      }),
      listProjects: vi.fn().mockRejectedValue(new Error('list lost')),
    });
    const { result } = await renderReadyHook({
      selection,
      provisioning: fakeProvisioning(),
      platform: fakePlatform(),
    });
    expect(result.current.targetListFailed).toBe(true);
    expect(result.current.projects).toEqual([]);
  });
});

function JourneyHarness(props: UseOnboardingOptions) {
  const api = useOnboarding(props);
  return <OnboardingJourney api={api} />;
}

describe('OnboardingJourney', () => {
  it('walks the fresh-install happy path: workspace → project → ready → Open Adham', async () => {
    const user = userEvent.setup();
    const selection = fakeSelection();
    const provisioning = fakeProvisioning();
    render(
      <JourneyHarness
        selection={selection}
        provisioning={provisioning}
        platform={fakePlatform()}
      />,
    );

    await screen.findByRole('heading', { name: 'Set up your workspace' });
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'My WS');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await screen.findByRole('heading', { name: 'Create your first project' });
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'My Project');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await screen.findByRole('heading', { name: 'Your workspace is ready' });
    expect(screen.getByText('My WS')).toBeTruthy();
    expect(screen.getByText('My Project')).toBeTruthy();
    expect(provisioning.createWorkspace).toHaveBeenCalledTimes(1);
    expect(provisioning.createProject).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Open Adham' }));
    await waitFor(() => expect(screen.queryByRole('heading')).toBeNull());
  });

  it('continues from an existing workspace and confirms an existing project', async () => {
    const user = userEvent.setup();
    const selection = fakeSelection({
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [{ workspaceId: 'ws-9', name: 'Old WS' }],
        truncated: false,
      }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ projectId: 'proj-9', name: 'Old Proj' }],
        truncated: false,
      }),
    });
    const provisioning = fakeProvisioning();
    render(
      <JourneyHarness
        selection={selection}
        provisioning={provisioning}
        platform={fakePlatform()}
      />,
    );

    await screen.findByRole('button', { name: 'Old WS' });
    await user.click(screen.getByRole('button', { name: 'Old WS' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('button', { name: 'Old Proj' });
    await user.click(screen.getByRole('button', { name: 'Old Proj' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Your workspace is ready' });
    expect(provisioning.createWorkspace).not.toHaveBeenCalled();
    expect(provisioning.createProject).not.toHaveBeenCalled();
    expect(selection.selectProject).toHaveBeenCalledWith(
      'ws-9',
      { projectId: 'proj-9' },
      { requestId: expect.any(String) },
    );
  });

  it('marks the current step in the rail and moves it forward', async () => {
    const user = userEvent.setup();
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={fakeProvisioning()}
        platform={fakePlatform()}
      />,
    );
    const rail = await screen.findByRole('list', { name: 'Setup steps' });
    expect(rail.textContent).toContain('Workspace');
    const current = rail.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('Workspace');
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'WS');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('heading', { name: 'Create your first project' });
    const moved = screen
      .getByRole('list', { name: 'Setup steps' })
      .querySelector('[aria-current="step"]');
    expect(moved?.textContent).toContain('Project');
  });

  it('shows a retry on a failed state read instead of an empty setup', async () => {
    const user = userEvent.setup();
    const selection = fakeSelection({
      getBootstrapState: vi.fn().mockRejectedValueOnce(new Error('ipc down')).mockResolvedValue({
        isInitialized: false,
        activeWorkspaceId: null,
        activeProjectId: null,
      }),
    });
    render(
      <JourneyHarness
        selection={selection}
        provisioning={fakeProvisioning()}
        platform={fakePlatform()}
      />,
    );
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Set up your workspace' });
  });

  it('blocks the journey while storage is degraded and recovers on retry', async () => {
    const user = userEvent.setup();
    const platform = fakePlatform('degraded');
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={fakeProvisioning()}
        platform={platform}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Local storage is unavailable');
    platform.getStorageStatus.mockResolvedValue({ status: 'ready' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Set up your workspace' });
  });

  it('blocks setup mutations while readiness is unconfirmed and recovers', async () => {
    const user = userEvent.setup();
    const platform = { getStorageStatus: vi.fn().mockRejectedValue(new Error('status lost')) };
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={fakeProvisioning()}
        platform={platform}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain(
      'Setup availability could not be confirmed',
    );
    // Step content (and therefore every mutation control) is replaced.
    expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();
    platform.getStorageStatus.mockResolvedValue({ status: 'ready' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Set up your workspace' });
  });

  it('switches language from the first screen and dispatches the new locale', async () => {
    const user = userEvent.setup();
    const provisioning = fakeProvisioning();
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={provisioning}
        platform={fakePlatform()}
      />,
    );
    await screen.findByRole('heading', { name: 'Set up your workspace' });
    await user.selectOptions(screen.getByRole('combobox'), 'ar');
    await screen.findByRole('heading', { name: 'إعداد مساحة العمل' });
    await user.type(screen.getByRole('textbox', { name: 'اسم مساحة العمل' }), 'My WS');
    await user.click(screen.getByRole('button', { name: 'إنشاء مساحة عمل' }));
    await screen.findByRole('heading', { name: 'أنشئ مشروعك الأول' });
    const payload = provisioning.createWorkspace.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload.preferredLanguage).toBe('ar');
  });

  it('keeps the frozen request identity across an uncertain retry under a language switch', async () => {
    const user = userEvent.setup();
    const provisioning = fakeProvisioning();
    provisioning.createWorkspace
      .mockRejectedValueOnce(new Error('transport lost'))
      .mockResolvedValueOnce({
        workspaceId: 'ws-1',
        name: 'My WS',
        kind: 'personal',
        preferredLanguage: 'en',
        createdAt: '2026-10-14T00:00:00Z',
      });
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={provisioning}
        platform={fakePlatform()}
      />,
    );
    await screen.findByRole('heading', { name: 'Set up your workspace' });
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'My WS');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('alert'); // uncertain outcome surfaced, not swallowed

    await user.selectOptions(screen.getByRole('combobox'), 'ar');
    await user.click(screen.getByRole('button', { name: 'إنشاء مساحة عمل' }));
    await screen.findByRole('heading', { name: 'أنشئ مشروعك الأول' });

    expect(provisioning.createWorkspace).toHaveBeenCalledTimes(2);
    const [firstPayload, firstOptions] = provisioning.createWorkspace.mock.calls[0] ?? [];
    const [secondPayload, secondOptions] = provisioning.createWorkspace.mock.calls[1] ?? [];
    // The replay reuses the frozen identity and payload fingerprint,
    // including the original locale, despite the live language switch.
    expect(secondOptions.requestId).toBe(firstOptions.requestId);
    expect(secondPayload).toEqual(firstPayload);
    expect(secondPayload.preferredLanguage).toBe('en');
  });

  it('renders the guide column beside the form column', async () => {
    render(
      <JourneyHarness
        selection={fakeSelection()}
        provisioning={fakeProvisioning()}
        platform={fakePlatform()}
      />,
    );
    await screen.findByRole('heading', { name: 'Set up your workspace' });
    // Full-width step rail, mascot stage, and the step description under the
    // form heading coexist with the actionable form; the old showcase copy
    // stays removed.
    expect(screen.getByRole('list', { name: 'Setup steps' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your projects and settings live here. You can rename it or add more later.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeTruthy();
    expect(screen.queryByText('One workspace for everything')).toBeNull();
  });
});
