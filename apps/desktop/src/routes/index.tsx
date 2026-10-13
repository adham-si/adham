import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';
import { ConversationPanel } from '@/features/conversation/conversation-panel';
import { useSelection } from '@/features/workspace-selection/use-selection';
import { WorkspaceSelection } from '@/features/workspace-selection/workspace-selection';
import {
  ProvisionDialog,
  type ProvisionDialogTarget,
} from '@/features/workspace-selection/provision-dialog';
import { announceScopeChanged } from '@/features/conversation/conversation-identity';
import { useProjectSessions } from '@/features/conversation/use-project-sessions';
import { SettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  // Sidebar discovery owns its own read lifecycle; a confirmed selection
  // announces scope-changed for the conversation surface to follow.
  const sel = useSelection();
  const handleSelectProject = React.useCallback(
    (workspaceId: string, projectId: string) => {
      void sel.select(workspaceId, projectId);
    },
    [sel],
  );

  const [provisionTarget, setProvisionTarget] = React.useState<ProvisionDialogTarget | null>(null);

  const handleCreateWorkspace = React.useCallback(() => {
    setProvisionTarget({ type: 'workspace' });
  }, []);

  const handleCreateProject = React.useCallback(
    (workspaceId: string) => {
      const ws = sel.workspaces.find((w) => w.workspaceId === workspaceId);
      setProvisionTarget({
        type: 'project',
        workspaceId,
        workspaceName: ws?.name ?? workspaceId,
      });
    },
    [sel.workspaces],
  );

  const handleProvisionSuccess = React.useCallback(
    (target: ProvisionDialogTarget, id: string, name?: string) => {
      if (target.type === 'workspace') {
        announceScopeChanged('workspace', 'created', {
          workspaceId: id,
          projectId: null,
        });
        void sel.refresh();
        setProvisionTarget({
          type: 'project',
          workspaceId: id,
          workspaceName: name || 'New Workspace',
        });
      } else {
        announceScopeChanged('project', 'created', {
          workspaceId: target.workspaceId,
          projectId: id,
        });
        void sel.refresh();
        setProvisionTarget(null);
      }
    },
    [sel],
  );

  const {
    sessions,
    activeSessionId,
    selectSession,
    newSession,
    creating: sessionsCreating,
    error: sessionsError,
    truncated: sessionsTruncated,
    refresh: refreshSessions,
  } = useProjectSessions({
    workspaceId: sel.activeWorkspaceId,
    projectId: sel.activeProjectId,
  });

  const selectionMenu = (
    <WorkspaceSelection
      workspaces={sel.workspaces}
      projectsBy={sel.projectsBy}
      truncatedWorkspaces={sel.truncatedWorkspaces}
      truncatedProjects={sel.truncatedProjects}
      failedWorkspaces={sel.failedProjectLists}
      activeWorkspaceId={sel.activeWorkspaceId}
      activeProjectId={sel.activeProjectId}
      loading={sel.loading}
      listError={sel.listError}
      disabled={sel.working}
      selectError={sel.error}
      onSelectProject={handleSelectProject}
      onRetryLists={() => void sel.refresh()}
      onCreateWorkspace={handleCreateWorkspace}
      onCreateProject={handleCreateProject}
    />
  );
  return (
    <Shell
      titlebar={<Titlebar />}
      navRail={<NavRail />}
      sidebar={
        <Sidebar
          primaryProps={{
            selectionMenu,
            sessions,
            activeSessionId,
            error: sessionsError,
            onRetry: () => void refreshSessions(),
            truncated: sessionsTruncated,
            creatingSession: sessionsCreating,
            onSelectSession: selectSession,
            onNewSession: () => void newSession(),
          }}
        />
      }
      panel={<Panel />}
      overlays={
        <>
          <SettingsPage />
          <ProvisionDialog
            open={provisionTarget !== null}
            target={provisionTarget}
            onClose={() => setProvisionTarget(null)}
            onSuccess={handleProvisionSuccess}
          />
        </>
      }
    >
      <Context>
        <ConversationPanel />
      </Context>
    </Shell>
  );
}
