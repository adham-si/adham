import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@adham/ui';
import type { OnboardingJourneyApi } from '../model/use-onboarding';

/**
 * Workspace step: pick an existing workspace to continue with, or create a
 * new one. Creation advances the journey only on a confirmed response.
 */
export function WorkspaceStep({ api }: { api: OnboardingJourneyApi }) {
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
    await api.createWorkspace(trimmed);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">
          {t('onboarding.workspaceHeading', 'Set up your workspace')}
        </h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          {t(
            'onboarding.workspaceDescription',
            'Your projects and settings live here. You can rename it or add more later.',
          )}
        </p>
      </div>

      {api.workspaces.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('onboarding.existingWorkspaces', 'Existing workspaces')}
          </span>
          <ul className="flex flex-col gap-1">
            {api.workspaces.map((ws) => (
              <li key={ws.workspaceId}>
                <button
                  type="button"
                  onClick={() => api.chooseWorkspace(ws.workspaceId)}
                  aria-pressed={api.target?.workspaceId === ws.workspaceId}
                  className="flex w-full items-center overflow-hidden rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover aria-pressed:bg-selection aria-pressed:text-action disabled:opacity-60"
                  disabled={api.working}
                >
                  {ws.name}
                </button>
              </li>
            ))}
          </ul>
          {api.truncatedWorkspaces && (
            <p className="text-xs text-foreground-muted">
              {t('onboarding.truncated', 'Some entries are hidden because the list is limited.')}
            </p>
          )}
        </div>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {t('provision.workspaceLabel', 'Workspace name')}
        </label>
        <Input
          id={inputId}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (localError) setLocalError(null);
          }}
          placeholder={t('provision.workspacePlaceholder')}
          disabled={api.working}
        />
        {localError && (
          <p role="alert" className="text-xs text-danger-foreground">
            {localError}
          </p>
        )}
        <Button type="submit" disabled={!name.trim() || api.working} loading={api.working}>
          {t('provision.createWorkspace', 'Create workspace')}
        </Button>
      </form>

      {api.target && (
        <Button
          type="button"
          variant="secondary"
          onClick={api.continueFromWorkspace}
          disabled={api.working}
        >
          {t('onboarding.continue', 'Continue')}
        </Button>
      )}
    </div>
  );
}
