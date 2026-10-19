import i18n from '@/shared/i18n';
import type { ConversationBackend, ConversationContext } from './conversation-scope';
import { isDefinitePreEffectRejection, rejectionMessage } from '@/shared/api/error-envelope';
import { readStorage, removeStorage, writeStorage } from '@/shared/lib/session-storage';
import {
  clearDurablePendingOperation,
  recordDurablePendingOperation,
} from './pending-recovery/durable-pending-operations';

export const PENDING_FIRST_SEND_KEY = 'adham:compose:pending-first-send';

export type UiMessage = { id: string; role: string; text: string; createdAt: string };

export const DEFAULT_SESSION_TITLE_MAX_LENGTH = 40;

/**
 * Derive a short, clean session title preview from the first submitted message.
 * Normalizes all whitespace sequences into a single space and truncates safely with an ellipsis.
 */
export function deriveSessionTitle(
  text: string,
  maxLength = DEFAULT_SESSION_TITLE_MAX_LENGTH,
): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return i18n.t('compose.newSession');
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * A tracked first-send operation in an unsaved session.
 * Tracks both the session-creation request ID and the message request ID.
 * Freezes the derived or explicit title so retries cannot alter the creation
 * payload while reusing the createRequestId.
 * If session creation succeeds but message submission fails, `sessionId`
 * is retained so an explicit retry reuses the created session instead
 * of minting another empty session.
 *
 * NOTE ON STORAGE LIFETIME:
 * Persisted in sessionStorage. Survives re-renders, route transitions,
 * and page reloads within the same session. Does NOT establish durability
 * across a full application quit/restart.
 */
export interface PendingFirstSend {
  createRequestId: string;
  messageRequestId: string;
  text: string;
  title: string;
  workspaceId: string;
  projectId: string;
  sessionId: string | null;
}

export function readPendingFirstSend(): PendingFirstSend | null {
  const raw = readStorage(PENDING_FIRST_SEND_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFirstSend>;
    if (
      typeof parsed.createRequestId === 'string' &&
      typeof parsed.messageRequestId === 'string' &&
      typeof parsed.text === 'string' &&
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string'
    ) {
      return {
        createRequestId: parsed.createRequestId,
        messageRequestId: parsed.messageRequestId,
        text: parsed.text,
        title:
          typeof parsed.title === 'string' && parsed.title.trim().length > 0
            ? parsed.title
            : deriveSessionTitle(parsed.text),
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writePendingFirstSend(record: PendingFirstSend): boolean {
  return writeStorage(PENDING_FIRST_SEND_KEY, JSON.stringify(record));
}

export function removePendingFirstSend(): void {
  removeStorage(PENDING_FIRST_SEND_KEY);
}

export function isPendingFirstSendForScope(workspaceId: string, projectId: string): boolean {
  const pending = readPendingFirstSend();
  return pending !== null && pending.workspaceId === workspaceId && pending.projectId === projectId;
}

export function pendingFirstSendBlockedReason(
  workspaceId: string,
  projectId: string,
  text: string,
): string | null {
  const pending = readPendingFirstSend();
  if (!pending) return null;
  if (pending.workspaceId === workspaceId && pending.projectId === projectId) {
    if (pending.text === text) {
      return null; // Same scope and text: explicit retry allowed
    }
    return i18n.t('conversation.firstSendPendingReload');
  }
  return null;
}

export interface LazyFirstSendParams {
  backend: ConversationBackend;
  workspaceId: string;
  projectId: string;
  text: string;
  title?: string | null;
  installationId?: string | null;
  /** An attachment-only first send: the file carries the turn, so empty text
   *  is valid and the session title falls back to the default. */
  allowEmptyText?: boolean;
  isStale: () => boolean;
}

export type LazyFirstSendFailure = {
  ok: false;
  error: string;
  uncertain: boolean;
  createdContext?: ConversationContext;
};

export type LazyFirstSendOutcome =
  | {
      ok: true;
      context: ConversationContext;
      title: string;
      message: UiMessage;
      cleanupWarning?: string;
    }
  | LazyFirstSendFailure;

export type LazyFirstSendPrepareOutcome =
  | {
      ok: true;
      /** Trimmed text the tracked identity belongs to. */
      text: string;
      context: ConversationContext;
      sessionId: string;
      title: string;
      /** Identity of the message request; also the durable operation id. */
      messageRequestId: string;
    }
  | LazyFirstSendFailure;

/**
 * Prepare the tracked lazy creation of an unsaved conversation's session.
 *
 * Captures request identities and the derived/explicit title before any
 * backend call, records the durable `first_send` operation, and creates the
 * session — reusing a tracked identity (and an already created session) on an
 * explicit retry instead of minting another empty session.
 *
 * The caller owns the turn itself: the text-only path submits through
 * `performLazyFirstSend`, the streaming path dispatches into the returned
 * context and resolves the tracked identity once the dispatch is confirmed
 * persisted.
 */
export async function prepareLazyFirstSend(
  params: LazyFirstSendParams,
): Promise<LazyFirstSendPrepareOutcome> {
  const { backend, workspaceId, projectId, text, installationId, isStale } = params;
  const trimmed = text.trim();
  if (!trimmed && !params.allowEmptyText) {
    return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
  }

  // 1. Check if an unresolved first send exists in SQLite first
  let durablePendingOp = null;
  try {
    const sqliteList = await backend.listPendingOperations();
    durablePendingOp =
      sqliteList.operations.find(
        (op) =>
          op.kind === 'first_send' && op.workspaceId === workspaceId && op.projectId === projectId,
      ) ?? null;
    if (!durablePendingOp && sqliteList.truncated) {
      return {
        ok: false,
        error: i18n.t('conversation.firstSendPendingReload'),
        uncertain: true,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : i18n.t('conversation.identityNotRecorded');
    return { ok: false, error: message, uncertain: false };
  }

  const pending = readPendingFirstSend();
  let createRequestId: string;
  let messageRequestId: string;
  let createdSessionId: string | null = null;
  let title: string;
  let alreadyRecordedDurable = false;

  if (durablePendingOp) {
    if (durablePendingOp.text === trimmed) {
      if (!durablePendingOp.createRequestId) {
        return {
          ok: false,
          error: i18n.t('conversation.firstSendPendingReload'),
          uncertain: true,
        };
      }
      createRequestId = durablePendingOp.createRequestId;
      messageRequestId = durablePendingOp.messageRequestId;
      createdSessionId = durablePendingOp.sessionId;
      title = durablePendingOp.title ?? (params.title?.trim() || deriveSessionTitle(trimmed));
      alreadyRecordedDurable = true;
    } else {
      return {
        ok: false,
        error: i18n.t('conversation.firstSendPendingReload'),
        uncertain: true,
      };
    }
  } else if (pending) {
    if (
      pending.workspaceId === workspaceId &&
      pending.projectId === projectId &&
      pending.text === trimmed
    ) {
      createRequestId = pending.createRequestId;
      messageRequestId = pending.messageRequestId;
      createdSessionId = pending.sessionId;
      title = pending.title;
      alreadyRecordedDurable = false;
    } else {
      return {
        ok: false,
        error: i18n.t('conversation.firstSendPendingReload'),
        uncertain: true,
      };
    }
  } else {
    createRequestId = crypto.randomUUID();
    messageRequestId = crypto.randomUUID();
    title = params.title?.trim() || deriveSessionTitle(trimmed);
    alreadyRecordedDurable = false;
  }

  const operationId = messageRequestId;
  if (!alreadyRecordedDurable) {
    const durableRes = await recordDurablePendingOperation(
      backend,
      workspaceId,
      projectId,
      {
        operationId,
        kind: 'first_send',
        messageRequestId,
        createRequestId,
        text: trimmed,
        title,
      },
      { sessionId: null },
    );
    if (!durableRes.ok) {
      return {
        ok: false,
        error: i18n.t('conversation.identityNotRecorded'),
        uncertain: false,
      };
    }

    const initialRecord: PendingFirstSend = {
      createRequestId,
      messageRequestId,
      text: trimmed,
      title,
      workspaceId,
      projectId,
      sessionId: null,
    };
    if (!writePendingFirstSend(initialRecord)) {
      return {
        ok: false,
        error: i18n.t('conversation.identityNotRecorded'),
        uncertain: false,
      };
    }
  }

  // Create the session if the tracked identity has none yet
  if (!createdSessionId) {
    try {
      const created = await backend.createSession(
        workspaceId,
        projectId,
        { title },
        { requestId: createRequestId },
      );
      createdSessionId = created.sessionId;
    } catch (err) {
      if (isStale()) {
        return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
      }
      if (isDefinitePreEffectRejection(err)) {
        await clearDurablePendingOperation(backend, {
          operationId,
          expectedMessageRequestId: messageRequestId,
          reason: 'dismissed',
        });
        removePendingFirstSend();
        return { ok: false, error: rejectionMessage(err), uncertain: false };
      }
      const rawMsg = err instanceof Error ? err.message : i18n.t('conversation.creationFailed');
      return {
        ok: false,
        error: `${rawMsg} Save status is unknown. Reload history before resending.`,
        uncertain: true,
      };
    }

    // Update pending record with created sessionId
    const recorded = writePendingFirstSend({
      createRequestId,
      messageRequestId,
      text: trimmed,
      title,
      workspaceId,
      projectId,
      sessionId: createdSessionId,
    });
    if (!recorded) {
      return {
        ok: false,
        error: i18n.t('conversation.createdIdentityLost'),
        uncertain: true,
      };
    }

    if (isStale()) {
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }
  }

  if (isStale()) {
    return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
  }

  const createdCtx: ConversationContext = {
    workspaceId,
    projectId,
    sessionId: createdSessionId,
    ...(installationId ? { installationId } : {}),
  };

  return {
    ok: true,
    text: trimmed,
    context: createdCtx,
    sessionId: createdSessionId,
    title,
    messageRequestId,
  };
}

/**
 * Execute the tracked lazy session creation and first-message send.
 *
 * If createSession succeeds but submitMessage fails, the created session id is
 * kept in PendingFirstSend so an explicit retry continues into the created
 * session without creating a second empty session (the non-atomic two-command
 * limitation).
 */
export async function performLazyFirstSend(
  params: LazyFirstSendParams,
): Promise<LazyFirstSendOutcome> {
  const { backend, isStale } = params;
  const prepared = await prepareLazyFirstSend(params);
  if (!prepared.ok) return prepared;
  const { context: createdCtx, title, messageRequestId, text: trimmed, sessionId } = prepared;
  const { workspaceId, projectId } = createdCtx;

  // Step 2: Submit message
  try {
    const submitted = await backend.submitMessage(
      workspaceId,
      projectId,
      sessionId,
      { text: trimmed },
      { requestId: messageRequestId },
    );

    if (isStale()) {
      removePendingFirstSend();
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }

    // Success! Clear pending first send
    const clearRes = await clearDurablePendingOperation(backend, {
      operationId: messageRequestId,
      expectedMessageRequestId: messageRequestId,
      reason: 'resolved',
    });
    removePendingFirstSend();

    return {
      ok: true,
      context: createdCtx,
      title,
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
    if (isStale()) {
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }
    const rawMsg = err instanceof Error ? err.message : i18n.t('error.notSaved');
    return {
      ok: false,
      error: `${rawMsg} Message was not saved. Retry to save into this session.`,
      uncertain: true,
      createdContext: createdCtx,
    };
  }
}
