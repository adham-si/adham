import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MenuContent, MenuGroup, MenuItem, MenuRoot, MenuTrigger } from '@adham/ui';
import type { ProjectSummary, WorkspaceSummary } from '@adham/contracts-generated';

export interface WorkspaceSelectionProps {
  workspaces: WorkspaceSummary[];
  projectsBy: Record<string, ProjectSummary[]>;
  truncatedWorkspaces: boolean;
  truncatedProjects: Record<string, boolean>;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  loading: boolean;
  listError: string | null;
  /** Held while a selection or creation is in flight. */
  disabled?: boolean | undefined;
  selectError: string | null;
  onSelectProject: (workspaceId: string, projectId: string) => void;
  /** Offered only for workspaces without projects: choose the workspace so
   * its first project can be created. Omitted surfaces keep the honest
   * "no projects" text instead. */
  onChooseWorkspace?: ((workspaceId: string) => void) | undefined;
  onRetryLists?: (() => void) | undefined;
}

function projectValue(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function workspaceValue(workspaceId: string): string {
  return `ws:${workspaceId}`;
}

/**
 * Deliberate discovery UI: existing workspaces with their projects, one
 * Menu surface. Choosing dispatches nothing by itself — the container runs
 * the frozen-intent selection (project) or advances to first-project
 * creation (workspace). Reused in the sidebar header and the first-run
 * selection slot: one design, two placements.
 */
export function WorkspaceSelection({
  workspaces,
  projectsBy,
  truncatedWorkspaces,
  truncatedProjects,
  activeWorkspaceId,
  activeProjectId,
  loading,
  listError,
  disabled = false,
  selectError,
  onSelectProject,
  onChooseWorkspace,
  onRetryLists,
}: WorkspaceSelectionProps) {
  const { t } = useTranslation();

  const activeLabel = React.useMemo(() => {
    if (activeWorkspaceId && activeProjectId) {
      const proj = (projectsBy[activeWorkspaceId] ?? []).find(
        (p) => p.projectId === activeProjectId,
      );
      if (proj) return proj.name;
      const ws = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
      return ws ? ws.name : t('selectScope', 'Select workspace / project');
    }
    return t('selectScope', 'Select workspace / project');
  }, [activeProjectId, activeWorkspaceId, projectsBy, t, workspaces]);

  const handleSelect = React.useCallback(
    (value: string) => {
      if (value.startsWith('ws:')) {
        onChooseWorkspace?.(value.slice(3));
        return;
      }
      const sep = value.indexOf(':');
      if (sep <= 0) return;
      onSelectProject(value.slice(0, sep), value.slice(sep + 1));
    },
    [onChooseWorkspace, onSelectProject],
  );

  if (!loading && workspaces.length === 0 && !listError) {
    return (
      <p className="px-3 py-2 text-xs text-foreground-muted">
        {t('noWorkspaces', 'No workspaces yet')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <MenuRoot>
        <MenuTrigger
          disabled={disabled || loading}
          aria-label={t('selectScope', 'Select workspace / project')}
          className="flex w-full items-center justify-between gap-1 overflow-hidden rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-60"
        >
          <span className="truncate font-semibold">
            {loading ? t('loading', 'Loading…') : activeLabel}
          </span>
          <span aria-hidden="true" className="text-foreground-muted">
            ▾
          </span>
        </MenuTrigger>
        <MenuContent label={t('selectScope', 'Select workspace / project')} onSelect={handleSelect}>
          {workspaces.map((ws) => {
            const projects = projectsBy[ws.workspaceId] ?? [];
            return (
              <MenuGroup key={ws.workspaceId} label={ws.name}>
                {projects.map((proj: ProjectSummary) => (
                  <MenuItem
                    key={proj.projectId}
                    value={projectValue(ws.workspaceId, proj.projectId)}
                    active={proj.projectId === activeProjectId}
                    disabled={disabled}
                  >
                    {proj.name}
                  </MenuItem>
                ))}
                {projects.length === 0 && !loading ? (
                  onChooseWorkspace ? (
                    <MenuItem value={workspaceValue(ws.workspaceId)} disabled={disabled}>
                      {t('createFirstProject', 'Create first project…')}
                    </MenuItem>
                  ) : (
                    <p className="px-3 py-1 text-xs text-foreground-muted">
                      {t('noProjects', 'No projects yet')}
                    </p>
                  )
                ) : null}
                {truncatedProjects[ws.workspaceId] ? (
                  <p className="px-3 py-1 text-xs text-foreground-muted">
                    {t('truncatedProjects', 'Showing first 100 projects')}
                  </p>
                ) : null}
              </MenuGroup>
            );
          })}
          {truncatedWorkspaces ? (
            <p className="px-3 py-1 text-xs text-foreground-muted">
              {t('truncatedWorkspaces', 'Showing first 100 workspaces')}
            </p>
          ) : null}
        </MenuContent>
      </MenuRoot>
      {listError ? (
        <div role="alert" className="flex items-center gap-2 px-2 text-xs text-danger-foreground">
          <span className="truncate">{listError}</span>
          {onRetryLists ? (
            <button type="button" onClick={onRetryLists} className="shrink-0 underline">
              {t('retry', 'Retry')}
            </button>
          ) : null}
        </div>
      ) : null}
      {selectError ? (
        <p role="alert" className="px-2 text-xs text-danger-foreground">
          {selectError}
        </p>
      ) : null}
    </div>
  );
}
