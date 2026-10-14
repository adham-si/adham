import * as React from 'react';
import type { PendingOperationDto } from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { isDefinitePreEffectRejection } from '@/shared/api/error-envelope';
import { SCOPE_CHANGED_EVENT } from '../../provisioning';
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
  const [cleanupWarning, setCleanupWarning] = React.useState<string | null>(null);

  const [activeReviewOp, setActiveReviewOp] = React.useState<PendingOperationDto | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = React.useState(false);
  const [validatingTarget, setValidatingTarget] = React.useState(false);
  const [targetMissing, setTargetMissing] = React.useState(false);
  const [initialDismissConfirm, setInitialDismissConfirm] = React.useState(false);

  // Controller guards and generation fences
  const operationInFlightRef = React.useRef(false);
  const reviewGenerationRef = React.useRef(0);
  const recoveryGenerationRef = React.useRef(0);

  React.useEffect(() => {
    const onNavigated = () => {
      reviewGenerationRef.current += 1;
      recoveryGenerationRef.current += 1;
      setReviewDialogOpen(false);
      setActiveReviewOp(null);
      setValidatingTarget(false);
      setTargetMissing(false);
    };
    window.addEventListener(SCOPE_CHANGED_EVENT, onNavigated);
    window.addEventListener('adham:session-select', onNavigated);
    return () => {
      window.removeEventListener(SCOPE_CHANGED_EVENT, onNavigated);
      window.removeEventListener('adham:session-select', onNavigated);
    };
  }, []);

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
    async (op: PendingOperationDto, options?: { initialDismissConfirm?: boolean }) => {
      reviewGenerationRef.current += 1;
      const gen = reviewGenerationRef.current;
      setActiveReviewOp(op);
      setReviewDialogOpen(true);
      setInitialDismissConfirm(options?.initialDismissConfirm ?? false);
      setValidatingTarget(true);
      setTargetMissing(false);

      const valid = await checkTargetValid(op);
      if (reviewGenerationRef.current !== gen) return; // Discard late review validation

      setValidatingTarget(false);
      setTargetMissing(!valid);
    },
    [checkTargetValid],
  );

  const openDismiss = React.useCallback(
    (op: PendingOperationDto) => {
      void openReview(op, { initialDismissConfirm: true });
    },
    [openReview],
  );

  const closeReview = React.useCallback(() => {
    reviewGenerationRef.current += 1;
    recoveryGenerationRef.current += 1;
    setReviewDialogOpen(false);
    setActiveReviewOp(null);
    setTargetMissing(false);
    setValidatingTarget(false);
    setInitialDismissConfirm(false);
  }, []);

  const resendOperation = React.useCallback(
    async (op: PendingOperationDto): Promise<{ ok: boolean; error?: string }> => {
      if (operationInFlightRef.current) {
        return { ok: false, error: 'Operation already in flight.' };
      }
      operationInFlightRef.current = true;
      recoveryGenerationRef.current += 1;
      const gen = recoveryGenerationRef.current;

      try {
        let finalSessionId = op.sessionId;

        // First-send recovery: reject malformed records missing createRequestId
        if (op.kind === 'first_send') {
          if (!op.createRequestId) {
            return {
              ok: false,
              error: 'Malformed first-send recovery record: createRequestId is required.',
            };
          }
          const createReqId = op.createRequestId;
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
          // Cleanup failure must be preserved as actionable warning, surviving refresh
          setCleanupWarning(i18n.t('conversation.recovery.cleanupFailed'));
        }

        if (recoveryGenerationRef.current !== gen) {
          // Generation fenced: user navigated or switched review context
          return { ok: true };
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
    async (op: PendingOperationDto): Promise<{ ok: boolean; error?: string }> => {
      if (operationInFlightRef.current) return { ok: false, error: 'Operation in flight.' };
      operationInFlightRef.current = true;
      try {
        const clearRes = await clearDurablePendingOperation(backend, {
          operationId: op.operationId,
          expectedMessageRequestId: op.messageRequestId,
          reason: 'dismissed',
        });
        if (!clearRes.ok) {
          return { ok: false, error: clearRes.error };
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
    [backend, refresh],
  );

  return {
    operations,
    truncated,
    loading,
    error,
    cleanupWarning,
    clearCleanupWarning: () => setCleanupWarning(null),
    refresh,
    activeReviewOp,
    reviewDialogOpen,
    validatingTarget,
    targetMissing,
    initialDismissConfirm,
    openReview,
    openDismiss,
    closeReview,
    resendOperation,
    dismissOperation,
  };
}
