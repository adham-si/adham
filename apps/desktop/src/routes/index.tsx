import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';
import { ConversationPanel, useProjectSessions } from '@/features/conversation';
import {
  useProvisionFlow,
  WorkspaceSelection,
  ProvisionDialog,
} from '@/features/workspace-selection';
import { useOnboarding, OnboardingJourney } from '@/features/onboarding';
import { SettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

/// Composition only: discovery/dialog orchestration lives in the
/// workspace-selection feature, session history in conversation, and the
/// first-run journey in onboarding. The route wires results into the shell.
function IndexComponent() {
  const onboarding = useOnboarding();

  // Incomplete first-run setup keeps the window chrome but hides the app
  // regions; the journey derives its phase from backend-confirmed state, so
  // a returning install goes straight to the full shell below.
  if (onboarding.phase !== 'complete') {
    return (
      <Shell titlebar={<Titlebar />}>
        <OnboardingJourney api={onboarding} />
      </Shell>
    );
  }

  return <AppBody />;
}

function AppBody() {
  const {
    sel,
    provisionTarget,
    openCreateWorkspace,
    openCreateProject,
    closeProvision,
    handleProvisionSuccess,
  } = useProvisionFlow();

  const handleSelectProject = React.useCallback(
    (workspaceId: string, projectId: string) => {
      void sel.select(workspaceId, projectId);
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
      onCreateWorkspace={openCreateWorkspace}
      onCreateProject={openCreateProject}
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
            onClose={closeProvision}
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
