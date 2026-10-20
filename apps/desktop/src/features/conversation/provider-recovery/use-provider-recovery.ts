import * as React from 'react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import i18n from '@/shared/i18n';
import type { ConversationBackend } from '../conversation-scope';

export const PROVIDER_RECOVERY_KIND = 'provider-completion';

export interface MarkInterruptedResult {
  ok: boolean;
  error?: string;
}

/**
 * Stale provider dispatch handles (`provider-completion`) have their own
 * lifecycle: they are never unsent messages, so they never enter the message
 * recovery flow. The backend list already excludes resolved rows and live
 * operations; here we only keep the provider kind and the pending status.
 */
export function useProviderRecovery({ backend }: { backend: ConversationBackend }) {
  const [operations, setOperations] = React.useState<PendingOperationDto[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busyOperationId, setBusyOperationId] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    try {
      const list = await backend.listPendingOperations();
      setOperations(
        list.operations.filter(
          (op) => op.kind === PROVIDER_RECOVERY_KIND && op.status === 'pending',
        ),
      );
      setError(null);
    } catch {
      setError(i18n.t('conversation.providerRecovery.listFailed'));
    }
  }, [backend]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const markInterrupted = React.useCallback(
    async (op: PendingOperationDto): Promise<MarkInterruptedResult> => {
      if (
        inFlightRef.current ||
        !op.sessionId ||
        typeof backend.markCompletionInterrupted !== 'function'
      ) {
        return { ok: false, error: i18n.t('conversation.providerRecovery.failed') };
      }
      inFlightRef.current = true;
      setBusyOperationId(op.operationId);
      try {
        await backend.markCompletionInterrupted(op.workspaceId, op.projectId, op.sessionId, {
          operationId: op.operationId,
          expectedMessageRequestId: op.messageRequestId,
        });
        await refresh();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : i18n.t('conversation.providerRecovery.failed'),
        };
      } finally {
        inFlightRef.current = false;
        setBusyOperationId(null);
      }
    },
    [backend, refresh],
  );

  return { operations, error, busyOperationId, refresh, markInterrupted };
}
