import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import {
  announceScopeChanged,
  useProvisioning,
  type ProvisioningBackend,
} from '../../conversation';
import { useSelection, type SelectionBackend } from '../../workspace-selection';

export type OnboardingStep = 'workspace' | 'project' | 'ready';
export type OnboardingPhase = 'checking' | 'error' | 'setup' | 'ready' | 'complete';

/// Minimal platform surface: the one genuine blocker read. Unknown statuses
/// never block — the backend still fail-closes on its own.
export interface OnboardingPlatformBackend {
  getStorageStatus(): Promise<{ status: string }>;
}

export interface OnboardingTarget {
  workspaceId: string;
  workspaceName: string;
  /// True when this session just created the workspace: its project list is
  /// known-empty without waiting for discovery.
  fresh: boolean;
}

export interface OnboardingJourneyApi {
  phase: OnboardingPhase;
  step: OnboardingStep;
  /// Backend-confirmed storage failure blocking setup. Not a checklist.
  blocker: 'storage' | null;
  /// Localized provisioning/selection error for the active step, if any.
  error: string | null;
  /// Localized list-read error, when discovery failed or is only partial.
  listError: string | null;
  working: boolean;
  loaded: boolean;
  truncatedWorkspaces: boolean;
  truncatedProjects: boolean;
  workspaces: { workspaceId: string; name: string }[];
  target: OnboardingTarget | null;
  /// Projects of the target workspace; null when discovery has not confirmed.
  projects: { projectId: string; name: string }[] | null;
  targetListFailed: boolean;
  readyWorkspace: string | null;
  readyProject: string | null;
  createWorkspace: (name: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  chooseWorkspace: (workspaceId: string) => void;
  continueFromWorkspace: () => void;
  chooseProject: (projectId: string) => void;
  selectedProjectId: string | null;
  confirmProject: () => Promise<void>;
  back: () => void;
  enter: () => void;
  retry: () => void;
}

export interface UseOnboardingOptions {
  selection?: SelectionBackend | undefined;
  provisioning?: ProvisioningBackend | undefined;
  platform?: OnboardingPlatformBackend | undefined;
}

/**
 * First-run journey model. The gate derives only from backend-confirmed
 * state (bootstrap scope + storage status): a fresh install starts at the
 * workspace step, an interrupted workspace-without-project install resumes
 * at the project step, and a populated returning install bypasses setup
 * entirely — never a persisted client "completed" flag. Nothing dispatches
 * on mount; creation and selection reuse the frozen-identity hooks so an
 * uncertain retry replays instead of forking. Reaching "ready" requires a
 * successful create/select response in this session; "Open Adham" is local
 * acknowledgment for this session only.
 */
export function useOnboarding({
  selection,
  provisioning,
  platform = adhamClient,
}: UseOnboardingOptions = {}): OnboardingJourneyApi {
  const [entered, setEntered] = React.useState(false);
  const sel = useSelection({ backend: selection, enabled: !entered });
  const prov = useProvisioning({ backend: provisioning });

  const [awaitingReady, setAwaitingReady] = React.useState(false);
  const [step, setStep] = React.useState<OnboardingStep>('workspace');
  const [seeded, setSeeded] = React.useState(false);
  const [storage, setStorage] = React.useState<'checking' | 'ready' | 'degraded' | 'unknown'>(
    'checking',
  );
  const [target, setTarget] = React.useState<OnboardingTarget | null>(null);
  const [projectChoice, setProjectChoice] = React.useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const [readyNames, setReadyNames] = React.useState<{ workspace: string; project: string } | null>(
    null,
  );

  const readStorage = React.useCallback(async () => {
    try {
      const status = await platform.getStorageStatus();
      setStorage(
        status.status === 'degraded' ? 'degraded' : status.status === 'ready' ? 'ready' : 'unknown',
      );
    } catch {
      setStorage('unknown');
    }
  }, [platform]);

  React.useEffect(() => {
    void readStorage();
  }, [readStorage]);

  // Seed once from backend-confirmed discovery: resume an interrupted setup
  // at the step the persisted scope implies.
  React.useEffect(() => {
    if (!sel.loaded || seeded) return;
    setSeeded(true);
    if (sel.activeWorkspaceId) {
      const ws = sel.workspaces.find((w) => w.workspaceId === sel.activeWorkspaceId);
      setTarget({
        workspaceId: sel.activeWorkspaceId,
        workspaceName: ws?.name ?? sel.activeWorkspaceId,
        fresh: false,
      });
    }
    setStep(sel.activeWorkspaceId ? (sel.activeProjectId ? 'ready' : 'project') : 'workspace');
  }, [sel.loaded, sel.activeWorkspaceId, sel.activeProjectId, sel.workspaces, seeded]);

  const retry = React.useCallback(() => {
    setStorage('checking');
    void readStorage();
    void sel.refresh();
  }, [readStorage, sel]);

  const targetListFailed =
    target !== null && !target.fresh && sel.failedProjectLists.includes(target.workspaceId);
  const projects =
    target === null
      ? null
      : target.fresh
        ? []
        : (sel.projectsBy[target.workspaceId] ?? (targetListFailed ? [] : null));

  const createWorkspace = React.useCallback(
    async (name: string) => {
      const outcome = await prov.createWorkspace(name);
      if (!outcome.ok) return;
      setTarget({ workspaceId: outcome.id, workspaceName: name.trim(), fresh: true });
      setProjectChoice(null);
      announceScopeChanged('workspace', 'created', {
        workspaceId: outcome.id,
        projectId: null,
      });
      setStep('project');
    },
    [prov],
  );

  const createProject = React.useCallback(
    async (name: string) => {
      const workspaceId = target?.workspaceId ?? sel.activeWorkspaceId;
      if (!workspaceId) return;
      const outcome = await prov.createProject(name, workspaceId);
      if (!outcome.ok) return;
      announceScopeChanged('project', 'created', { workspaceId, projectId: outcome.id });
      setReadyNames({ workspace: target?.workspaceName ?? workspaceId, project: name.trim() });
      setProjectChoice(null);
      setAwaitingReady(true);
      setStep('ready');
    },
    [prov, sel.activeWorkspaceId, target],
  );

  const chooseWorkspace = React.useCallback(
    (workspaceId: string) => {
      const ws = sel.workspaces.find((w) => w.workspaceId === workspaceId);
      setTarget({ workspaceId, workspaceName: ws?.name ?? workspaceId, fresh: false });
      setProjectChoice(null);
    },
    [sel.workspaces],
  );

  const continueFromWorkspace = React.useCallback(() => setStep('project'), []);

  const chooseProject = React.useCallback(
    (projectId: string) => {
      const project = projects?.find((p) => p.projectId === projectId);
      setProjectChoice(project ? { projectId, name: project.name } : null);
    },
    [projects],
  );

  const confirmProject = React.useCallback(async () => {
    if (!target || !projectChoice) return;
    const outcome = await sel.select(target.workspaceId, projectChoice.projectId);
    if (!outcome.ok) return;
    setReadyNames({ workspace: target.workspaceName, project: projectChoice.name });
    setAwaitingReady(true);
    setStep('ready');
  }, [projectChoice, sel, target]);

  const back = React.useCallback(() => {
    setStep((current) => (current === 'ready' ? 'project' : 'workspace'));
  }, []);

  const enter = React.useCallback(() => setEntered(true), []);

  const phase: OnboardingPhase = entered
    ? 'complete'
    : !sel.loaded
      ? sel.loading || !sel.listError
        ? 'checking'
        : 'error'
      : storage === 'checking'
        ? 'checking'
        : sel.activeWorkspaceId && sel.activeProjectId
          ? awaitingReady
            ? 'ready'
            : 'complete'
          : 'setup';

  const blocking = phase === 'setup' || phase === 'ready';

  return {
    phase,
    step,
    blocker: blocking && storage === 'degraded' ? 'storage' : null,
    error: prov.error ?? sel.error,
    listError: sel.listError,
    working: prov.working || sel.working,
    loaded: sel.loaded,
    truncatedWorkspaces: sel.truncatedWorkspaces,
    truncatedProjects: target ? (sel.truncatedProjects[target.workspaceId] ?? false) : false,
    workspaces: sel.workspaces.map((w) => ({ workspaceId: w.workspaceId, name: w.name })),
    target,
    projects,
    targetListFailed,
    readyWorkspace: readyNames?.workspace ?? null,
    readyProject: readyNames?.project ?? null,
    createWorkspace,
    createProject,
    chooseWorkspace,
    continueFromWorkspace,
    chooseProject,
    selectedProjectId: projectChoice?.projectId ?? null,
    confirmProject,
    back,
    enter,
    retry,
  };
}
