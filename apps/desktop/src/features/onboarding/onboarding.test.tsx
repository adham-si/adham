import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOnboarding, type UseOnboardingOptions } from './model/use-onboarding';
import { OnboardingJourney } from './ui/onboarding-journey';
import type { SelectionBackend } from '../workspace-selection';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
    expect(result.current.blocker).toBe('storage');
    platform.getStorageStatus.mockResolvedValue({ status: 'ready' });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.blocker).toBeNull());
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
});
