import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import type { ExportSessionResponse, SessionMetadata } from '@adham/contracts-generated';
import { rejectionMessage } from '@/shared/api/error-envelope';
import i18n from '@/shared/i18n';

export interface SessionActionTarget {
  id: string;
  title: string;
  summary?: string | null;
  summaryOrigin?: string | null;
}

export interface SessionActionsBackend {
  renameSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    title: string,
  ): Promise<SessionMetadata>;
  setSessionPinned(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    pinned: boolean,
  ): Promise<SessionMetadata>;
  setSessionArchived(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    archived: boolean,
  ): Promise<SessionMetadata>;
  setSessionSummary(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    summary: string | null,
  ): Promise<SessionMetadata>;
  duplicateSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    title: string | null,
  ): Promise<SessionMetadata>;
  exportSessionMarkdown(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ExportSessionResponse>;
}

export interface UseSessionActionsOptions {
  workspaceId: string | null;
  projectId: string | null;
  onChanged: () => void | Promise<void>;
  backend?: SessionActionsBackend;
}

export function useSessionActions({
  workspaceId,
  projectId,
  onChanged,
  backend = adhamClient,
}: UseSessionActionsOptions) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<SessionActionTarget | null>(null);
  const [exportTarget, setExportTarget] = React.useState<SessionActionTarget | null>(null);

  const run = React.useCallback(
    async (sessionId: string, action: () => Promise<SessionMetadata>) => {
      if (!workspaceId || !projectId) return;
      setBusyId(sessionId);
      setError(null);
      try {
        await action();
        await onChanged();
      } catch (err) {
        setError(rejectionMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [workspaceId, projectId, onChanged],
  );

  const openRename = React.useCallback((target: SessionActionTarget) => {
    setError(null);
    setRenameTarget(target);
  }, []);

  const cancelRename = React.useCallback(() => {
    setRenameTarget(null);
  }, []);

  const openExport = React.useCallback((target: SessionActionTarget) => {
    setError(null);
    setExportTarget(target);
  }, []);

  const closeExport = React.useCallback(() => {
    setExportTarget(null);
    setError(null);
  }, []);

  const exportSession = React.useCallback(
    async (target: SessionActionTarget): Promise<ExportSessionResponse | null> => {
      if (!workspaceId || !projectId) return null;
      setBusyId(target.id);
      setError(null);
      try {
        return await backend.exportSessionMarkdown(workspaceId, projectId, target.id);
      } catch (err) {
        setError(rejectionMessage(err));
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [backend, projectId, workspaceId],
  );

  const saveRename = React.useCallback(
    async (title: string) => {
      if (!renameTarget || !workspaceId || !projectId) return;
      setBusyId(renameTarget.id);
      setError(null);
      try {
        await backend.renameSession(workspaceId, projectId, renameTarget.id, title.trim());
        await onChanged();
        setRenameTarget(null);
      } catch (err) {
        setError(rejectionMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [backend, onChanged, projectId, renameTarget, workspaceId],
  );

  const saveSummary = React.useCallback(
    async (summary: string | null) => {
      if (!renameTarget || !workspaceId || !projectId) return;
      const target = renameTarget;
      const normalized = summary?.trim() || null;
      setBusyId(target.id);
      setError(null);
      try {
        const metadata = await backend.setSessionSummary(
          workspaceId,
          projectId,
          target.id,
          normalized,
        );
        await onChanged();
        setRenameTarget((current) =>
          current && current.id === target.id
            ? {
                ...current,
                summary: metadata.summaryOrigin === 'user' ? normalized : null,
                summaryOrigin: metadata.summaryOrigin ?? null,
              }
            : current,
        );
      } catch (err) {
        setError(rejectionMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [backend, onChanged, projectId, renameTarget, workspaceId],
  );

  const duplicate = React.useCallback(
    async (target: SessionActionTarget) => {
      if (!workspaceId || !projectId) return;
      setBusyId(target.id);
      setError(null);
      try {
        const localized = String(
          i18n.t('conversation.sessionActions.duplicateTitle', {
            title: target.title,
            defaultValue: '{{title}} copy',
          }),
        );
        const title = Array.from(localized).slice(0, 120).join('') || `${target.title} copy`;
        const metadata = await backend.duplicateSession(
          workspaceId,
          projectId,
          target.id,
          title,
        );
        await onChanged();
        window.dispatchEvent(
          new CustomEvent('adham:session-select', {
            detail: { workspaceId, projectId, sessionId: metadata.sessionId },
          }),
        );
      } catch (err) {
        setError(rejectionMessage(err));
      } finally {
        setBusyId(null);
      }
    },
    [backend, onChanged, projectId, workspaceId],
  );

  const setPinned = React.useCallback(
    (sessionId: string, pinned: boolean) =>
      run(sessionId, () => backend.setSessionPinned(workspaceId!, projectId!, sessionId, pinned)),
    [backend, projectId, run, workspaceId],
  );

  const setArchived = React.useCallback(
    (sessionId: string, archived: boolean) =>
      run(sessionId, () =>
        backend.setSessionArchived(workspaceId!, projectId!, sessionId, archived),
      ),
    [backend, projectId, run, workspaceId],
  );

  return {
    busyId,
    error,
    renameTarget,
    openRename,
    cancelRename,
    saveRename,
    saveSummary,
    duplicate,
    exportTarget,
    openExport,
    closeExport,
    exportSession,
    setPinned,
    setArchived,
  };
}
