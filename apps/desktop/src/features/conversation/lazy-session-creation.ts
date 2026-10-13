import i18n from '@/shared/i18n';
import type { ConversationBackend, ConversationContext } from './conversation-scope';
import {
  isDefinitePreEffectRejection,
  readStorage,
  rejectionMessage,
  removeStorage,
  writeStorage,
} from './conversation-identity';

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
  isStale: () => boolean;
}

export type LazyFirstSendOutcome =
  | {
      ok: true;
      context: ConversationContext;
      title: string;
      message: UiMessage;
    }
  | {
      ok: false;
      error: string;
      uncertain: boolean;
      createdContext?: ConversationContext;
    };

/**
 * Execute a tracked lazy session creation and first-message send.
 *
 * Captures request identities and derived/explicit title before any backend call.
 * If createSession succeeds but submitMessage fails, createdSessionId is stored
 * in PendingFirstSend so that an explicit retry continues into the created session
 * without creating a second empty session (addressing the non-atomic two-command limitation).
 */
export async function performLazyFirstSend(
  params: LazyFirstSendParams,
): Promise<LazyFirstSendOutcome> {
  const { backend, workspaceId, projectId, text, installationId, isStale } = params;
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: i18n.t('conversation.emptyMessage'), uncertain: false };
  }

  // 1. Check if an unresolved first send exists
  const pending = readPendingFirstSend();
  let createRequestId: string;
  let messageRequestId: string;
  let createdSessionId: string | null = null;
  let title: string;
  let reusedFrozenIdentity = false;

  if (pending) {
    if (
      pending.workspaceId === workspaceId &&
      pending.projectId === projectId &&
      pending.text === trimmed
    ) {
      // Explicit retry with same text and scope: reuse frozen identities and title
      createRequestId = pending.createRequestId;
      messageRequestId = pending.messageRequestId;
      createdSessionId = pending.sessionId;
      title = pending.title;
      reusedFrozenIdentity = true;
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
  }

  if (!reusedFrozenIdentity) {
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

  // 2. Step 1: Create session if not already created
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

  // 3. Step 2: Submit message
  try {
    const submitted = await backend.submitMessage(
      workspaceId,
      projectId,
      createdSessionId,
      { text: trimmed },
      { requestId: messageRequestId },
    );

    if (isStale()) {
      removePendingFirstSend();
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }

    // Success! Clear pending first send
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
    };
  } catch (err) {
    if (isStale()) {
      return { ok: false, error: i18n.t('conversation.sessionChanged'), uncertain: false };
    }
    // Two-command limitation: session exists on backend, but message failed.
    // Retain createdSessionId in pending first send so retry reuses it!
    const rawMsg = err instanceof Error ? err.message : i18n.t('error.notSaved');
    return {
      ok: false,
      error: `${rawMsg} Message was not saved. Retry to save into this session.`,
      uncertain: true,
      createdContext: createdCtx,
    };
  }
}
