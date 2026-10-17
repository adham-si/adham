import type {
  ClearPendingOperationPayload,
  PendingOperationDto,
  PendingOperationList,
  RecordPendingOperationPayload,
} from '@adham/contracts-generated';
import type { ConversationBackend } from '../conversation-scope';
import { readPendingSend, removePendingSend } from '../conversation-identity';
import { readPendingFirstSend, removePendingFirstSend } from '../lazy-session-creation';

/**
 * Record a pending operation durably in SQLite before dispatch.
 * Returns true if persisted, false if persistence failed.
 */
export async function recordDurablePendingOperation(
  backend: ConversationBackend,
  workspaceId: string,
  projectId: string,
  payload: RecordPendingOperationPayload,
  options?: { requestId?: string; sessionId?: string | null },
): Promise<{ ok: true; operation: PendingOperationDto } | { ok: false; error: string }> {
  try {
    const op = await backend.recordPendingOperation(workspaceId, projectId, payload, options);
    return { ok: true, operation: op };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * List all unresolved pending operations across all scopes from SQLite.
 * Harmonizes with existing session-scoped records without silently erasing them.
 *
 * Only the message-recovery kinds are listed here: the banner's Review &
 * Resend flow applies to unsent message text, not to provider dispatch
 * handles (`provider-completion`), which have their own lifecycle — a
 * crashed provider op stays pending and must never be presented (or
 * resolvable) as an unsent message.
 */
export const MESSAGE_RECOVERY_KINDS = ['single_message', 'first_send'] as const;

export async function listDurablePendingOperations(
  backend: ConversationBackend,
): Promise<{ ok: true; list: PendingOperationList } | { ok: false; error: string }> {
  try {
    const legacy = readPendingSend();
    const legacyFirst = readPendingFirstSend();

    const list = await backend.listPendingOperations();
    const ops: PendingOperationDto[] = [...list.operations].filter(
      (op): op is PendingOperationDto =>
        (MESSAGE_RECOVERY_KINDS as readonly string[]).includes(op.kind),
    );
    const truncated = list.truncated;

    // Conservative handling of existing session-scoped records: include if not already present
    if (
      legacy &&
      !ops.some(
        (op) => op.operationId === legacy.requestId || op.messageRequestId === legacy.requestId,
      )
    ) {
      ops.push({
        operationId: legacy.requestId,
        kind: 'single_message',
        workspaceId: legacy.workspaceId,
        projectId: legacy.projectId,
        sessionId: legacy.sessionId,
        createRequestId: null,
        messageRequestId: legacy.requestId,
        text: legacy.text,
        title: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }

    if (
      legacyFirst &&
      !ops.some(
        (op) =>
          op.operationId === legacyFirst.messageRequestId ||
          op.messageRequestId === legacyFirst.messageRequestId,
      )
    ) {
      ops.push({
        operationId: legacyFirst.messageRequestId,
        kind: 'first_send',
        workspaceId: legacyFirst.workspaceId,
        projectId: legacyFirst.projectId,
        sessionId: legacyFirst.sessionId,
        createRequestId: legacyFirst.createRequestId,
        messageRequestId: legacyFirst.messageRequestId,
        text: legacyFirst.text,
        title: legacyFirst.title,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }

    return { ok: true, list: { operations: ops, truncated } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Safely clear or dismiss a pending operation from both SQLite and sessionStorage.
 */
export async function clearDurablePendingOperation(
  backend: ConversationBackend,
  payload: ClearPendingOperationPayload,
  options?: { requestId?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await backend.clearPendingOperation(payload, options);
    const legacy = readPendingSend();
    if (
      legacy &&
      (legacy.requestId === payload.operationId ||
        legacy.requestId === payload.expectedMessageRequestId)
    ) {
      removePendingSend();
    }
    const legacyFirst = readPendingFirstSend();
    if (
      legacyFirst &&
      (legacyFirst.messageRequestId === payload.operationId ||
        legacyFirst.messageRequestId === payload.expectedMessageRequestId)
    ) {
      removePendingFirstSend();
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Find pending operation matching the specific session scope.
 */
export function findPendingForScope(
  operations: PendingOperationDto[],
  workspaceId: string,
  projectId: string,
  sessionId: string | null,
): PendingOperationDto | null {
  return (
    operations.find(
      (op) =>
        op.workspaceId === workspaceId &&
        op.projectId === projectId &&
        (sessionId === null ? op.sessionId === null : op.sessionId === sessionId),
    ) ?? null
  );
}
