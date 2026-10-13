import i18n from '@/shared/i18n';
import type { ConversationBackend } from './conversation-scope';
import {
  isDefinitePreEffectRejection,
  readPendingSend,
  rejectionMessage,
  removePendingSend,
  sameScope,
  type PendingSend,
  writePendingSend,
} from './conversation-identity';
import { readPendingFirstSend, removePendingFirstSend } from './lazy-session-creation';
import {
  clearDurablePendingOperation,
  findPendingForScope,
  recordDurablePendingOperation,
} from './pending-recovery/durable-pending-operations';

export type UiMessage = { id: string; role: string; text: string; createdAt: string };

export interface SingleMessageSendParams {
  backend: ConversationBackend;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  text: string;
  isStale: () => boolean;
  onIdentityRecorded?: (record: PendingSend) => void;
  onIdentityCleared?: () => void;
}

export type SingleMessageSendOutcome =
  | { ok: true; message: UiMessage; cleanupWarning?: string }
  | { ok: false; error: string; displayError?: string; uncertain: boolean };

/**
 * Execute a single-message send into an already-created session.
 * Freezes the logical command identity before dispatch to prevent duplicate writes.
 */
export async function performSingleMessageSend(
  params: SingleMessageSendParams,
): Promise<SingleMessageSendOutcome> {
  const {
    backend,
    workspaceId,
    projectId,
    sessionId,
    text,
    isStale,
    onIdentityRecorded,
    onIdentityCleared,
  } = params;

  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
  }

  // 1. Authoritative check: query SQLite pending operations directly
  let durablePendingOp = null;
  try {
    const sqliteList = await backend.listPendingOperations();
    durablePendingOp = findPendingForScope(
      sqliteList.operations,
      workspaceId,
      projectId,
      sessionId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : i18n.t('conversation.identityNotRecorded');
    return { ok: false, error: message, uncertain: false };
  }

  const pending = readPendingSend();
  const pendingFirst = readPendingFirstSend();
  let requestId: string;
  let operationId: string;
  let alreadyRecordedDurable = false;

  const ctxScope = { workspaceId, projectId, sessionId };

  if (durablePendingOp) {
    if (durablePendingOp.text === trimmed) {
      requestId = durablePendingOp.messageRequestId;
      operationId = durablePendingOp.operationId;
      alreadyRecordedDurable = true;
    } else {
      const message = i18n.t('conversation.unknownSaveReload');
      return { ok: false, error: message, uncertain: true };
    }
  } else if (pending) {
    if (sameScope(pending, ctxScope) && pending.text === trimmed) {
      requestId = pending.requestId;
      operationId = pending.requestId;
      alreadyRecordedDurable = false;
    } else {
      const message = i18n.t('conversation.unknownSaveReload');
      return { ok: false, error: message, uncertain: true };
    }
  } else if (
    pendingFirst &&
    pendingFirst.workspaceId === workspaceId &&
    pendingFirst.projectId === projectId
  ) {
    if (pendingFirst.sessionId === sessionId && pendingFirst.text === trimmed) {
      requestId = pendingFirst.messageRequestId;
      operationId = pendingFirst.messageRequestId;
      alreadyRecordedDurable = false;
    } else {
      const message = i18n.t('conversation.firstSendPendingReload');
      return { ok: false, error: message, uncertain: true };
    }
  } else {
    requestId = crypto.randomUUID();
    operationId = requestId;
    alreadyRecordedDurable = false;
  }

  const record: PendingSend = {
    requestId,
    text: trimmed,
    workspaceId,
    projectId,
    sessionId,
  };

  if (!alreadyRecordedDurable) {
    const durableRes = await recordDurablePendingOperation(
      backend,
      workspaceId,
      projectId,
      {
        operationId,
        kind: 'single_message',
        messageRequestId: requestId,
        createRequestId: null,
        text: trimmed,
        title: null,
      },
      { sessionId },
    );
    if (!durableRes.ok) {
      return {
        ok: false,
        error: i18n.t('conversation.identityNotRecorded'),
        uncertain: false,
      };
    }
    if (!writePendingSend(record)) {
      return {
        ok: false,
        error: i18n.t('conversation.identityNotRecorded'),
        uncertain: false,
      };
    }
  }

  if (onIdentityRecorded) {
    onIdentityRecorded(record);
  }

  const clearFrozenIdentity = async (
    reason: 'resolved' | 'dismissed' = 'resolved',
  ): Promise<{ ok: boolean; error?: string }> => {
    const clearRes = await clearDurablePendingOperation(backend, {
      operationId,
      expectedMessageRequestId: requestId,
      reason,
    });
    if (readPendingSend()?.requestId === requestId) {
      removePendingSend();
    }
    const currentFirst = readPendingFirstSend();
    if (
      currentFirst &&
      currentFirst.workspaceId === workspaceId &&
      currentFirst.projectId === projectId &&
      currentFirst.messageRequestId === requestId
    ) {
      removePendingFirstSend();
    }
    if (onIdentityCleared) {
      onIdentityCleared();
    }
    return clearRes;
  };

  try {
    const submitted = await backend.submitMessage(
      workspaceId,
      projectId,
      sessionId,
      { text: trimmed },
      { requestId },
    );

    if (isStale()) {
      await clearFrozenIdentity('resolved');
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }

    const clearRes = await clearFrozenIdentity('resolved');
    return {
      ok: true,
      message: {
        id: submitted.messageId,
        role: 'user',
        text: submitted.text,
        createdAt: submitted.createdAt,
      },
      ...(clearRes.ok
        ? {}
        : { cleanupWarning: clearRes.error ?? i18n.t('conversation.recovery.cleanupFailed') }),
    };
  } catch (err) {
    const definite = isDefinitePreEffectRejection(err);
    if (isStale()) {
      if (definite) await clearFrozenIdentity('dismissed');
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }
    if (definite) {
      await clearFrozenIdentity('dismissed');
      const message = rejectionMessage(err);
      return { ok: false, error: message, uncertain: false };
    }
    const message = err instanceof Error ? err.message : i18n.t('error.notSaved');
    return {
      ok: false,
      error: message,
      displayError: i18n.t('conversation.saveUnknownSuffix', { message }),
      uncertain: true,
    };
  }
}
