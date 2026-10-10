import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MenuContent, MenuGroup, MenuItem, MenuRoot, MenuTrigger } from '@adham/ui';
import type { ProjectSummary, WorkspaceSummary } from '@adham/contracts-generated';

export interface WorkspaceSelectionProps {
  workspaces: WorkspaceSummary[];
  projectsBy: Record<string, ProjectSummary[]>;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  loading: boolean;
  listError: string | null;
  /** Held while a selection or creation is in flight. */
  disabled?: boolean | undefined;
  selectError: string | null;
  onSelect: (workspaceId: string, projectId: string) => void;
  onRetryLists?: (() => void) | undefined;
}

function encodeValue(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

/**
 * Deliberate discovery UI: existing workspaces with their projects, one
 * Menu surface. Selecting dispatches nothing by itself — the container's
 * `onSelect` runs the frozen-intent selection. Reused in the sidebar
 * header and the first-run selection slot: one design, two placements.
 */
export function WorkspaceSelection({
  workspaces,
  projectsBy,
  activeWorkspaceId,
  activeProjectId,
  loading,
  listError,
  disabled = false,
  selectError,
  onSelect,
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
      const sep = value.indexOf(':');
      if (sep <= 0) return;
      onSelect(value.slice(0, sep), value.slice(sep + 1));
    },
    [onSelect],
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
          {workspaces.map((ws) => (
            <MenuGroup key={ws.workspaceId} label={ws.name}>
              {(projectsBy[ws.workspaceId] ?? []).map((proj: ProjectSummary) => (
                <MenuItem
                  key={proj.projectId}
                  value={encodeValue(ws.workspaceId, proj.projectId)}
                  active={proj.projectId === activeProjectId}
                  disabled={disabled}
                >
                  {proj.name}
                </MenuItem>
              ))}
              {(projectsBy[ws.workspaceId] ?? []).length === 0 && !loading ? (
                <p className="px-3 py-1 text-xs text-foreground-muted">
                  {t('noProjects', 'No projects yet')}
                </p>
              ) : null}
            </MenuGroup>
          ))}
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
