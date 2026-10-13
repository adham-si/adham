import * as React from 'react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { isDefinitePreEffectRejection } from '../conversation-identity';
import { isSessionMissingOrMismatched } from '../conversation-scope';
import {
  clearDurablePendingOperation,
  listDurablePendingOperations,
} from './durable-pending-operations';
import i18n from '@/shared/i18n';

export interface UsePendingRecoveryParams {
  backend: ConversationBackend;
  onSessionOpened?: (workspaceId: string, projectId: string, sessionId: string) => void;
}

export function usePendingRecovery({ backend, onSessionOpened }: UsePendingRecoveryParams) {
  const [operations, setOperations] = React.useState<PendingOperationDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [activeReviewOp, setActiveReviewOp] = React.useState<PendingOperationDto | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = React.useState(false);
  const [targetMissing, setTargetMissing] = React.useState(false);

  // Controller guard: prevents duplicate resend or dismiss clicks
  const operationInFlightRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const outcome = await listDurablePendingOperations(backend);
      if (outcome.ok) {
        setOperations(outcome.list.operations);
        setTruncated(outcome.list.truncated);
      } else {
        setError(i18n.t('conversation.recovery.listFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [backend]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkTargetValid = React.useCallback(
    async (op: PendingOperationDto): Promise<boolean> => {
      try {
        if (op.sessionId) {
          await backend.getConversation(op.workspaceId, op.projectId, op.sessionId);
          return true;
        } else if (typeof backend.listSessions === 'function') {
          await backend.listSessions({ workspaceId: op.workspaceId, projectId: op.projectId });
          return true;
        }
        return true;
      } catch (err) {
        if (isDefinitePreEffectRejection(err) || isSessionMissingOrMismatched(err)) {
          return false;
        }
        return true;
      }
    },
    [backend],
  );

  const openReview = React.useCallback(
    async (op: PendingOperationDto) => {
      setActiveReviewOp(op);
      setReviewDialogOpen(true);
      const valid = await checkTargetValid(op);
      setTargetMissing(!valid);
    },
    [checkTargetValid],
  );

  const closeReview = React.useCallback(() => {
    setReviewDialogOpen(false);
    setActiveReviewOp(null);
    setTargetMissing(false);
  }, []);

  const resendOperation = React.useCallback(
    async (op: PendingOperationDto): Promise<{ ok: boolean; error?: string }> => {
      if (operationInFlightRef.current) {
        return { ok: false, error: 'Operation already in flight.' };
      }
      operationInFlightRef.current = true;
      try {
        let finalSessionId = op.sessionId;

        // First-send recovery: replay creation request to recover or create session idempotently
        if (op.kind === 'first_send') {
          const createReqId = op.createRequestId ?? op.messageRequestId;
          try {
            const sessionResult = await backend.createSession(
              op.workspaceId,
              op.projectId,
              { title: op.title ?? null },
              { requestId: createReqId },
            );
            finalSessionId = sessionResult.sessionId;
          } catch (err) {
            if (isDefinitePreEffectRejection(err)) {
              setTargetMissing(true);
            }
            throw err;
          }
        }

        if (!finalSessionId) {
          return { ok: false, error: 'Session could not be identified.' };
        }

        // Replay original message submit request
        try {
          await backend.submitMessage(
            op.workspaceId,
            op.projectId,
            finalSessionId,
            { text: op.text },
            { requestId: op.messageRequestId },
          );
        } catch (err) {
          if (isDefinitePreEffectRejection(err) || isSessionMissingOrMismatched(err)) {
            setTargetMissing(true);
          }
          throw err;
        }

        // Clear durable marker upon confirmed save
        const clearRes = await clearDurablePendingOperation(backend, {
          operationId: op.operationId,
          expectedMessageRequestId: op.messageRequestId,
          reason: 'resolved',
        });

        if (!clearRes.ok) {
          // Cleanup failure must be preserved as actionable warning, not masked
          setError(i18n.t('conversation.recovery.cleanupFailed'));
        }

        // Open/switch to the recovered session
        if (onSessionOpened) {
          onSessionOpened(op.workspaceId, op.projectId, finalSessionId);
        }

        await refresh();
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      } finally {
        operationInFlightRef.current = false;
      }
    },
    [backend, onSessionOpened, refresh],
  );

  const dismissOperation = React.useCallback(
    async (op: PendingOperationDto) => {
      if (operationInFlightRef.current) return;
      operationInFlightRef.current = true;
      try {
        await clearDurablePendingOperation(backend, {
          operationId: op.operationId,
          expectedMessageRequestId: op.messageRequestId,
          reason: 'dismissed',
        });
        await refresh();
      } finally {
        operationInFlightRef.current = false;
      }
    },
    [backend, refresh],
  );

  return {
    operations,
    truncated,
    loading,
    error,
    refresh,
    activeReviewOp,
    reviewDialogOpen,
    targetMissing,
    openReview,
    closeReview,
    resendOperation,
    dismissOperation,
  };
}
