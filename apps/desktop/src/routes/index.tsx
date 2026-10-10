import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';
import { ConversationPanel } from '@/features/conversation/conversation-panel';
import { useSelection } from '@/features/workspace-selection/use-selection';
import { WorkspaceSelection } from '@/features/workspace-selection/workspace-selection';
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
  const selectionMenu = (
    <WorkspaceSelection
      workspaces={sel.workspaces}
      projectsBy={sel.projectsBy}
      activeWorkspaceId={sel.activeWorkspaceId}
      activeProjectId={sel.activeProjectId}
      loading={sel.loading}
      listError={sel.listError}
      disabled={sel.working}
      selectError={sel.error}
      onSelect={handleSelectProject}
      onRetryLists={() => void sel.refresh()}
    />
  );
  return (
    <Shell
      titlebar={<Titlebar />}
      navRail={<NavRail />}
      sidebar={<Sidebar primaryProps={{ selectionMenu }} />}
      panel={<Panel />}
      overlays={<SettingsPage />}
    >
      <Context>
        <ConversationPanel />
      </Context>
    </Shell>
  );
}
