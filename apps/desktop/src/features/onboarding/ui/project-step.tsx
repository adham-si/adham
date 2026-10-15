import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@adham/ui';
import type { OnboardingJourneyApi } from '../model/use-onboarding';

/**
 * Project step: create the first project in the target workspace, or pick an
 * existing one and confirm the selection. A failed project list is shown as a
 * failure with retry — never as an empty state.
 */
export function ProjectStep({ api }: { api: OnboardingJourneyApi }) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const inputId = React.useId();

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError(t('provision.nameRequired', 'Name must not be empty.'));
      return;
    }
    if (api.working) return;
    setLocalError(null);
    await api.createProject(trimmed);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">
          {t('onboarding.projectHeading', 'Create your first project')}
        </h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          {t(
            'onboarding.projectDescription',
            'Each project keeps its own storage, separate from the rest.',
          )}
        </p>
      </div>

      {api.target && (
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-subtle p-2.5 text-xs">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground-muted">
            {t('onboarding.stepWorkspace', 'Workspace')}
          </span>
          <span className="font-medium text-foreground">{api.target.workspaceName}</span>
        </div>
      )}

      {api.targetListFailed ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-xs text-danger-foreground">
            {t('onboarding.projectsFailed', 'Projects could not be loaded.')}
          </p>
          <Button type="button" variant="secondary" onClick={api.retry} disabled={api.working}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      ) : api.projects === null ? (
        <p className="text-xs text-foreground-muted" aria-busy="true">
          {t('onboarding.checking', 'Checking your setup…')}
        </p>
      ) : (
        api.projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
              {t('onboarding.existingProjects', 'Existing projects')}
            </span>
            <ul className="flex flex-col gap-1">
              {api.projects.map((project) => (
                <li key={project.projectId}>
                  <button
                    type="button"
                    onClick={() => api.chooseProject(project.projectId)}
                    aria-pressed={api.selectedProjectId === project.projectId}
                    className="flex w-full items-center overflow-hidden rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover aria-pressed:bg-selection aria-pressed:text-action disabled:opacity-60"
                    disabled={api.working}
                  >
                    {project.name}
                  </button>
                </li>
              ))}
            </ul>
            {api.truncatedProjects && (
              <p className="text-xs text-foreground-muted">
                {t('onboarding.truncated', 'Some entries are hidden because the list is limited.')}
              </p>
            )}
          </div>
        )
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {t('provision.projectLabel', 'Project name')}
        </label>
        <Input
          id={inputId}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (localError) setLocalError(null);
          }}
          placeholder={t('provision.projectPlaceholder')}
          disabled={api.working}
        />
        {localError && (
          <p role="alert" className="text-xs text-danger-foreground">
            {localError}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" onClick={api.back} disabled={api.working}>
            {t('onboarding.back', 'Back')}
          </Button>
          <Button type="submit" disabled={!name.trim() || api.working} loading={api.working}>
            {t('provision.createProject', 'Create project')}
          </Button>
        </div>
      </form>

      {api.selectedProjectId && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void api.confirmProject()}
          disabled={api.working}
        >
          {t('onboarding.continue', 'Continue')}
        </Button>
      )}
    </div>
  );
}
