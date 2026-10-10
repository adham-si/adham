import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import type {
  BootstrapState,
  ProjectList,
  ProjectSummary,
  WorkspaceList,
  WorkspaceSummary,
} from '@adham/contracts-generated';
import {
  announceScopeChanged,
  clearSelectIntent,
  isDefinitePreEffectRejection,
  readSelectIntent,
  rejectionMessage,
  SCOPE_CHANGED_EVENT,
  writeSelectIntent,
  type ScopeChangedDetail,
} from '../conversation/conversation-identity';

/// Minimal backend surface for discovery + explicit selection.
export interface SelectionBackend {
  getBootstrapState(): Promise<{
    isInitialized: boolean;
    activeWorkspaceId: string | null;
    activeProjectId: string | null;
  }>;
  listWorkspaces(): Promise<WorkspaceList>;
  listProjects(workspaceId: string): Promise<ProjectList>;
  selectProject(
    workspaceId: string,
    payload: { projectId: string },
    options?: { requestId?: string },
  ): Promise<BootstrapState>;
}

export type SelectOutcome =
  | { ok: true; scope: BootstrapState }
  | { ok: false; error: string; uncertain: boolean };

/**
 * Deliberate workspace/project discovery and selection. Lists are
 * read-only projections; selection is an explicit user action with its
 * identity frozen in storage BEFORE dispatch. While one selection is
 * unresolved, a different scope is blocked (never dispatched); the same
 * scope retries with the frozen identity so a delayed original replays
 * instead of forking. Mounts and reloads never auto-replay — only an
 * explicit same-scope retry dispatches. A confirmed success announces the
 * scope change for the conversation surface to follow.
 */
export function useSelection({
  backend = adhamClient,
  enabled = true,
}: {
  backend?: SelectionBackend | undefined;
  enabled?: boolean | undefined;
} = {}) {
  const [workspaces, setWorkspaces] = React.useState<WorkspaceSummary[]>([]);
  const [projectsBy, setProjectsBy] = React.useState<Record<string, ProjectSummary[]>>({});
  const [truncatedWorkspaces, setTruncatedWorkspaces] = React.useState(false);
  const [truncatedProjects, setTruncatedProjects] = React.useState<Record<string, boolean>>({});
  const [failedProjectLists, setFailedProjectLists] = React.useState<string[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loadSeqRef = React.useRef(0);
  const workingRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    setLoading(true);
    try {
      const [scope, found] = await Promise.all([
        backend.getBootstrapState(),
        backend.listWorkspaces(),
      ]);
      if (loadSeqRef.current !== seq) return;
      setActiveWorkspaceId(scope.activeWorkspaceId);
      setActiveProjectId(scope.activeProjectId);
      setWorkspaces(found.workspaces);
      setTruncatedWorkspaces(found.truncated);
      const grouped: Record<string, ProjectSummary[]> = {};
      const truncatedBy: Record<string, boolean> = {};
      const unreadable: string[] = [];
      await Promise.all(
        found.workspaces.map(async (ws) => {
          try {
            const listed = await backend.listProjects(ws.workspaceId);
            grouped[ws.workspaceId] = listed.projects;
            truncatedBy[ws.workspaceId] = listed.truncated;
          } catch {
            // Honest degradation: a failed workspace contributes no
            // projects AND is reported, never a silent empty.
            grouped[ws.workspaceId] = [];
            truncatedBy[ws.workspaceId] = false;
            unreadable.push(ws.workspaceId);
          }
          if (loadSeqRef.current !== seq) return;
        }),
      );
      if (loadSeqRef.current !== seq) return;
      setProjectsBy(grouped);
      setTruncatedProjects(truncatedBy);
      setFailedProjectLists(unreadable);
      setListError(
        unreadable.length > 0 ? 'Some project lists failed to load. Retry to refresh.' : null,
      );
      setLoaded(true);
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      setListError(err instanceof Error ? err.message : 'Workspace list failed to load.');
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [backend]);

  React.useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // Confirmed creations re-read the lists so every live instance (panel
  // slot, sidebar) shows new records. The confirmed scope IDs travel on the
  // event itself, so every instance synchronizes even when it did not
  // perform the change. Selections write no records, so their lists cannot
  // be stale.
  React.useEffect(() => {
    if (!enabled) return;
    const onScopeChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ScopeChangedDetail>>).detail;
      if (typeof detail?.workspaceId === 'string') {
        setActiveWorkspaceId(detail.workspaceId);
        setActiveProjectId(typeof detail?.projectId === 'string' ? detail.projectId : null);
      }
      if (detail?.origin !== 'selected') void refresh();
    };
    window.addEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
    return () => window.removeEventListener(SCOPE_CHANGED_EVENT, onScopeChanged);
  }, [enabled, refresh]);

  const select = React.useCallback(
    async (workspaceId: string, projectId: string): Promise<SelectOutcome> => {
      if (workingRef.current) {
        return { ok: false, error: 'Selection already in progress.', uncertain: false };
      }
      workingRef.current = true;
      setWorking(true);
      setError(null);
      try {
        const frozen = readSelectIntent();
        // A frozen intent for a different scope blocks: selecting away
        // while the previous outcome is unknown would fork authority.
        // This guard is storage-backed, so two live hook instances (panel
        // slot + sidebar) cannot dispatch competing selections either.
        if (frozen && (frozen.workspaceId !== workspaceId || frozen.projectId !== projectId)) {
          const message =
            'A previous selection has an unknown status. Retry it before selecting another scope.';
          setError(message);
          return { ok: false, error: message, uncertain: true };
        }
        const intent = frozen ?? {
          requestId: crypto.randomUUID(),
          workspaceId,
          projectId,
        };
        if (!frozen && !writeSelectIntent(intent)) {
          const message = 'Selection identity could not be recorded. Nothing was sent.';
          setError(message);
          return { ok: false, error: message, uncertain: false };
        }
        try {
          const scope = await backend.selectProject(
            workspaceId,
            { projectId },
            { requestId: intent.requestId },
          );
          // Apply only while this intent is still current: a stale success
          // must never overwrite newer selection state.
          if (readSelectIntent()?.requestId !== intent.requestId) {
            return { ok: false, error: 'Selection changed while confirming.', uncertain: false };
          }
          clearSelectIntent();
          setActiveWorkspaceId(scope.activeWorkspaceId);
          setActiveProjectId(scope.activeProjectId);
          setError(null);
          announceScopeChanged('project', 'selected', {
            workspaceId,
            projectId,
          });
          return { ok: true, scope };
        } catch (err) {
          // Proven pre-effect: nothing was stored, the identity is spent
          // and the prior durable selection stands untouched.
          if (isDefinitePreEffectRejection(err)) {
            clearSelectIntent();
            const message = rejectionMessage(err);
            setError(message);
            return { ok: false, error: message, uncertain: false };
          }
          const message = err instanceof Error ? err.message : 'Selection did not complete.';
          setError(`${message} Retry the same scope before selecting another.`);
          return { ok: false, error: message, uncertain: true };
        }
      } finally {
        workingRef.current = false;
        setWorking(false);
      }
    },
    [backend],
  );

  return {
    workspaces,
    projectsBy,
    truncatedWorkspaces,
    truncatedProjects,
    failedProjectLists,
    activeWorkspaceId,
    activeProjectId,
    hasRecords: workspaces.length > 0,
    loaded,
    loading,
    listError,
    working,
    error,
    refresh,
    select,
  };
}
