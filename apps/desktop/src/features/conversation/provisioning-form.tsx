import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@adham/ui';

export interface ProvisioningFormProps {
  step: 'workspace' | 'project';
  working: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}

/**
 * Deliberate first-run provisioning: one named step at a time, dispatched
 * only from an explicit user action. Rendered instead of the composer until
 * the backend-issued scope reaches the conversation.
 */
export function ProvisioningForm({ step, working, error, onSubmit }: ProvisioningFormProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const isWorkspace = step === 'workspace';

  const title = isWorkspace
    ? t('provision.workspaceTitle', 'Create your workspace')
    : t('provision.projectTitle', 'Create your project');
  const hint = isWorkspace
    ? t('provision.workspaceHint', 'A personal workspace holds your isolated projects.')
    : t('provision.projectHint', 'Projects use Adham-owned isolated storage.');
  const label = isWorkspace
    ? t('provision.workspaceLabel', 'Workspace name')
    : t('provision.projectLabel', 'Project name');
  const action = isWorkspace
    ? t('provision.createWorkspace', 'Create workspace')
    : t('provision.createProject', 'Create project');

  const submit = () => {
    if (!name.trim() || working) return;
    onSubmit(name);
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-foreground-muted">{hint}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span>{label}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={isWorkspace ? 'Personal' : 'My project'}
          disabled={working}
          aria-label={label}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}
      <Button onClick={submit} disabled={!name.trim() || working} loading={working}>
        {action}
      </Button>
    </div>
  );
}
