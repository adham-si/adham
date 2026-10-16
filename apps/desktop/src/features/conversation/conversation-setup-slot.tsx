import { useTranslation } from 'react-i18next';
import { WorkspaceSelection, type useSelection } from '../workspace-selection';
import { ProvisioningForm } from './provisioning-form';
import type { useProvisioning } from '../provisioning';

export interface ConversationSetupSlotProps {
  status: 'needs-workspace' | 'needs-project' | 'bootstrapping';
  activeWorkspaceId: string | null;
  provisionTransition: {
    step: 'workspace' | 'project';
    origin: 'created' | 'selected';
  } | null;
  sel: ReturnType<typeof useSelection>;
  prov: ReturnType<typeof useProvisioning>;
  formWorking: boolean;
  chosenWorkspaceId: string | null;
  setChosenWorkspaceId: (id: string | null) => void;
  onProvision: (name: string) => void;
  onSelect: (workspaceId: string, projectId: string) => void;
}

export function ConversationSetupSlot({
  status,
  activeWorkspaceId,
  provisionTransition,
  sel,
  prov,
  formWorking,
  chosenWorkspaceId,
  setChosenWorkspaceId,
  onProvision,
  onSelect,
}: ConversationSetupSlotProps) {
  const { t } = useTranslation();
  const step: 'workspace' | 'project' =
    status === 'needs-workspace'
      ? 'workspace'
      : status === 'needs-project'
        ? 'project'
        : (provisionTransition?.step ?? 'workspace');

  if (provisionTransition) {
    if (provisionTransition.origin === 'selected') {
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
          <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
            <WorkspaceSelection
              key={step}
              workspaces={sel.workspaces}
              projectsBy={sel.projectsBy}
              truncatedWorkspaces={sel.truncatedWorkspaces}
              truncatedProjects={sel.truncatedProjects}
              failedWorkspaces={sel.failedProjectLists}
              activeWorkspaceId={activeWorkspaceId ?? sel.activeWorkspaceId}
              activeProjectId={sel.activeProjectId}
              loading={false}
              listError={null}
              disabled
              selectError={null}
              onSelectProject={() => {}}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <ProvisioningForm
          key={provisionTransition.step}
          step={provisionTransition.step}
          working
          error={prov.error}
          onSubmit={() => {}}
        />
      </div>
    );
  }

  const totalProjects = Object.values(sel.projectsBy).reduce((n, ps) => n + ps.length, 0);
  const stepHasRecords =
    status === 'needs-workspace' ? sel.workspaces.length > 0 : totalProjects > 0;
  const activeProjectsFailed =
    status === 'needs-project' && sel.failedProjectLists.includes(activeWorkspaceId ?? '');

  if (sel.loading && !sel.loaded) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <p>{t('loading', 'Loading…')}</p>
      </div>
    );
  }

  if (chosenWorkspaceId !== null) {
    const isFailed = sel.failedProjectLists.includes(chosenWorkspaceId);
    const isLoaded = chosenWorkspaceId in sel.projectsBy;
    const chosenProjects = sel.projectsBy[chosenWorkspaceId];

    // Genuinely empty workspace: projects discovery completed, did not fail,
    // and confirmed 0 projects. Failed or unknown discovery MUST NOT offer creation.
    if (!isFailed && isLoaded && chosenProjects && chosenProjects.length === 0) {
      const chosenName =
        sel.workspaces.find((w) => w.workspaceId === chosenWorkspaceId)?.name ?? '';
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
          <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
            <p className="text-sm text-foreground-muted">
              {t('firstProjectIn', 'First project in {{name}}', { name: chosenName })}
            </p>
            <ProvisioningForm
              key={`project:${chosenWorkspaceId}`}
              step="project"
              working={formWorking}
              error={prov.error}
              onSubmit={(name) => void onProvision(name)}
            />
            <button
              type="button"
              onClick={() => setChosenWorkspaceId(null)}
              className="text-sm underline"
            >
              {t('allWorkspaces', 'All workspaces')}
            </button>
          </div>
        </div>
      );
    }
  }

  const chosenHadIssues =
    chosenWorkspaceId !== null &&
    (sel.failedProjectLists.includes(chosenWorkspaceId) || !(chosenWorkspaceId in sel.projectsBy));

  if (stepHasRecords || activeProjectsFailed || chosenHadIssues || (sel.listError && !sel.loaded)) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
          <WorkspaceSelection
            key={step}
            workspaces={sel.workspaces}
            projectsBy={sel.projectsBy}
            truncatedWorkspaces={sel.truncatedWorkspaces}
            truncatedProjects={sel.truncatedProjects}
            failedWorkspaces={sel.failedProjectLists}
            activeWorkspaceId={activeWorkspaceId ?? sel.activeWorkspaceId}
            activeProjectId={sel.activeProjectId}
            loading={sel.loading}
            listError={sel.listError}
            disabled={formWorking}
            selectError={sel.error}
            onSelectProject={(wsId, projId) => void onSelect(wsId, projId)}
            onChooseWorkspace={setChosenWorkspaceId}
            onRetryLists={() => void sel.refresh()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-transparent">
      <ProvisioningForm
        key={step}
        step={step}
        working={formWorking}
        error={prov.error}
        onSubmit={(name) => void onProvision(name)}
      />
    </div>
  );
}
