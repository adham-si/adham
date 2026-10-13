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
  | { ok: true; message: UiMessage }
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

  const pending = readPendingSend();
  const pendingFirst = readPendingFirstSend();
  let requestId: string;
  let reusedFrozenIdentity = false;

  const ctxScope = { workspaceId, projectId, sessionId };

  if (pending) {
    if (sameScope(pending, ctxScope) && pending.text === trimmed) {
      requestId = pending.requestId;
      reusedFrozenIdentity = true;
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
      reusedFrozenIdentity = true;
    } else {
      const message = i18n.t('conversation.firstSendPendingReload');
      return { ok: false, error: message, uncertain: true };
    }
  } else {
    requestId = crypto.randomUUID();
  }

  const record: PendingSend = {
    requestId,
    text: trimmed,
    workspaceId,
    projectId,
    sessionId,
  };

  if (!reusedFrozenIdentity && !writePendingSend(record)) {
    return {
      ok: false,
      error: i18n.t('conversation.identityNotRecorded'),
      uncertain: false,
    };
  }

  if (!reusedFrozenIdentity && onIdentityRecorded) {
    onIdentityRecorded(record);
  }

  const clearFrozenIdentity = () => {
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
      clearFrozenIdentity();
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }

    clearFrozenIdentity();
    return {
      ok: true,
      message: {
        id: submitted.messageId,
        role: 'user',
        text: submitted.text,
        createdAt: submitted.createdAt,
      },
    };
  } catch (err) {
    const definite = isDefinitePreEffectRejection(err);
    if (isStale()) {
      if (definite) clearFrozenIdentity();
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }
    if (definite) {
      clearFrozenIdentity();
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
