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
import {
  readPendingFirstSend,
  removePendingFirstSend,
  writePendingFirstSend,
} from './lazy-session-creation';

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
    return { ok: false, error: 'Message text cannot be empty.', uncertain: false };
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
      const message =
        'A previous message has an unknown save status. Reload history or resend it before sending another message.';
      return { ok: false, error: message, uncertain: true };
    }
  } else if (
    pendingFirst &&
    pendingFirst.workspaceId === workspaceId &&
    pendingFirst.projectId === projectId
  ) {
    if (
      (pendingFirst.sessionId === sessionId || pendingFirst.sessionId === null) &&
      pendingFirst.text === trimmed
    ) {
      requestId = pendingFirst.messageRequestId;
      reusedFrozenIdentity = true;
      if (pendingFirst.sessionId !== sessionId) {
        writePendingFirstSend({ ...pendingFirst, sessionId });
      }
    } else {
      const message =
        'A previous first-message save is pending resolution. Resend or reload before starting another conversation.';
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
      error: 'Save identity could not be recorded. The message was not sent.',
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
    if (readPendingFirstSend()?.messageRequestId === requestId) {
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
      return { ok: false, error: 'Session changed while sending.', uncertain: false };
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
      return { ok: false, error: 'Session changed while sending.', uncertain: false };
    }
    if (definite) {
      clearFrozenIdentity();
      const message = rejectionMessage(err);
      return { ok: false, error: message, uncertain: false };
    }
    const message = err instanceof Error ? err.message : 'Message was not saved.';
    return {
      ok: false,
      error: message,
      displayError: `${message} Save status is unknown. Reload history before resending.`,
      uncertain: true,
    };
  }
}
