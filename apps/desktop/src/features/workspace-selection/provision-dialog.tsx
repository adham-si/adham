import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  Input,
} from '@adham/ui';
import { useProvisioning, type ProvisioningBackend } from '../conversation';

export type ProvisionDialogTarget =
  | { type: 'workspace' }
  | { type: 'project'; workspaceId: string; workspaceName: string };

export interface ProvisionDialogProps {
  open: boolean;
  target: ProvisionDialogTarget | null;
  onClose: () => void;
  onSuccess: (target: ProvisionDialogTarget, id: string, name?: string) => void;
  backend?: ProvisioningBackend;
}

/**
 * Small modal dialog for post-initialization workspace and project creation.
 * Binds project creation explicitly to the target workspace ID.
 * Nothing is dispatched until the user submits.
 */
export function ProvisionDialog({
  open,
  target,
  onClose,
  onSuccess,
  backend,
}: ProvisionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const prov = useProvisioning({ backend });

  const targetKey = target
    ? target.type === 'workspace'
      ? 'workspace'
      : `project:${target.workspaceId}`
    : null;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const prevOpenRef = React.useRef(false);
  const prevKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (open && (!prevOpenRef.current || prevKeyRef.current !== targetKey)) {
      setName('');
      setLocalError(null);
      inputRef.current?.focus();
    }
    prevOpenRef.current = open;
    prevKeyRef.current = targetKey;
  }, [open, targetKey]);

  const handleCancel = React.useCallback(() => {
    if (prov.working) return;
    onClose();
  }, [onClose, prov.working]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) handleCancel();
    },
    [handleCancel],
  );

  if (!open || !target) return null;

  const isWorkspace = target.type === 'workspace';

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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError(t('provision.nameRequired', 'Name must not be empty.'));
      return;
    }
    if (prov.working) return;
    setLocalError(null);

    if (isWorkspace) {
      const outcome = await prov.createWorkspace(trimmed);
      if (outcome.ok) {
        onSuccess(target, outcome.id, trimmed);
      }
    } else {
      const outcome = await prov.createProject(trimmed, target.workspaceId);
      if (outcome.ok) {
        onSuccess(target, outcome.id, trimmed);
      }
    }
  };

  const errorMessage = localError ?? prov.error;

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" label={title}>
        <div className="flex flex-col gap-4">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{hint}</DialogDescription>
          </div>

          {!isWorkspace && (
            <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-subtle p-2.5 text-xs">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground-muted">
                {t('provision.targetWorkspace', 'Target Workspace')}
              </span>
              <span className="font-medium text-foreground">{target.workspaceName}</span>
              <span className="font-mono text-[10px] text-foreground-muted">
                {target.workspaceId}
              </span>
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">{label}</span>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (localError) setLocalError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              placeholder={
                isWorkspace
                  ? t('provision.workspacePlaceholder')
                  : t('provision.projectPlaceholder')
              }
              disabled={prov.working}
              aria-label={label}
            />
          </label>

          {errorMessage && (
            <p role="alert" className="text-xs text-danger-foreground">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={prov.working}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={!name.trim() || prov.working}
              loading={prov.working}
            >
              {action}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
