import * as React from 'react';
import { announceScopeChanged } from '../conversation';
import { useSelection, type SelectionBackend } from './use-selection';
import type { ProvisionDialogTarget } from './provision-dialog';

/**
 * Sidebar switcher provisioning flow. Owns the create-workspace /
 * create-project dialog target and the confirmed-creation hand-off (scope
 * announcement, list refresh, workspace → project chaining) so the root route
 * only wires results. Shares one selection-discovery instance with the
 * sidebar menu and session list; nothing dispatches until the dialog submit.
 */
export function useProvisionFlow({ backend }: { backend?: SelectionBackend | undefined } = {}) {
  const sel = useSelection({ backend });
  const [provisionTarget, setProvisionTarget] = React.useState<ProvisionDialogTarget | null>(null);

  const openCreateWorkspace = React.useCallback(() => {
    setProvisionTarget({ type: 'workspace' });
  }, []);

  const openCreateProject = React.useCallback(
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

  const closeProvision = React.useCallback(() => setProvisionTarget(null), []);

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

  return {
    sel,
    provisionTarget,
    openCreateWorkspace,
    openCreateProject,
    closeProvision,
    handleProvisionSuccess,
  };
}
