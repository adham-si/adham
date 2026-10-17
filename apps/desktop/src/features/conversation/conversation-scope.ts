import i18n from '@/shared/i18n';
import type { ConversationMessageDto } from '@/shared/api/adham-client';
import { isDefinitePreEffectRejection, rejectionMessage } from '@/shared/api/error-envelope';
import { removeStorage } from '@/shared/lib/session-storage';
import { SESSION_CACHE_KEY, readSessionCache } from './conversation-identity';

import {
  clearDurableSessionPreference,
  readDurableSessionPreference,
  writeDurableSessionPreference,
} from './durable-session-storage';

export type BootstrapSnapshot = {
  isInitialized: boolean;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  installationId?: string | null;
};

export type SessionSnapshot = { sessionId: string };
export type SubmittedSnapshot = { messageId: string; text: string; createdAt: string };
export type ConversationSnapshot = { items: ConversationMessageDto[] };

export interface ConversationBackend {
  getBootstrapState(): Promise<BootstrapSnapshot>;
  createSession(
    workspaceId: string,
    projectId: string,
    payload: { title: string | null },
    options?: { requestId?: string },
  ): Promise<SessionSnapshot>;
  submitMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: { text: string },
    options?: { requestId?: string },
  ): Promise<SubmittedSnapshot>;
  getConversation(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConversationSnapshot>;
  listSessions?(context: {
    workspaceId?: string;
    projectId: string;
  }): Promise<{ sessions: Array<{ sessionId: string; title: string | null; createdAt: string }> }>;
  recordPendingOperation(
    workspaceId: string,
    projectId: string,
    payload: import('@adham/contracts-generated').RecordPendingOperationPayload,
    options?: { requestId?: string; sessionId?: string | null },
  ): Promise<import('@adham/contracts-generated').PendingOperationDto>;
  listPendingOperations(): Promise<import('@adham/contracts-generated').PendingOperationList>;
  clearPendingOperation(
    payload: import('@adham/contracts-generated').ClearPendingOperationPayload,
    options?: { requestId?: string },
  ): Promise<void>;
  // Delivery A streaming (optional: capabilities-gated). The backend owns
  // the full turn: it persists the user text and the terminal outcome.
  completeOnceStreaming?(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: {
      accountId: string;
      modelId: string;
      text: string;
      /** Turn mode; dispatched as a request-only system instruction. */
      mode: 'ask' | 'plan' | 'code' | 'execute';
      /** Documented thinking parameter value; omitted = model default. */
      think?: boolean | string;
    },
    onEvent: (event: import('@adham/contracts-generated').StreamEventDto) => void,
    options?: { requestId?: string },
  ): Promise<import('@adham/contracts-generated').CompletionStartDto>;
  stopCompletion?(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    opId: string,
    options?: { requestId?: string },
  ): Promise<import('@adham/contracts-generated').StopCompletionResponse>;
  markCompletionInterrupted?(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    payload: import('@adham/contracts-generated').MarkCompletionInterruptedPayload,
    options?: { requestId?: string },
  ): Promise<import('@adham/contracts-generated').MarkCompletionInterruptedResponse>;
}

export type ConversationContext = {
  workspaceId: string;
  projectId: string;
  sessionId: string | null;
  installationId?: string | null;
};

export type ReadyNoSessionContext = {
  workspaceId: string;
  projectId: string;
  sessionId: null;
  installationId?: string | null;
};

export type ScopeResolutionOutcome =
  | { kind: 'needs-workspace'; activeWorkspaceId: string | null }
  | { kind: 'needs-project'; activeWorkspaceId: string }
  | { kind: 'resumed'; context: ConversationContext }
  | { kind: 'created'; context: ConversationContext }
  | { kind: 'ready-no-session'; context: ReadyNoSessionContext }
  | { kind: 'error'; message: string };

export function isSessionMissingOrMismatched(err: unknown): boolean {
  if (typeof err === 'string') {
    return (
      err.startsWith('SESSION_NOT_FOUND') ||
      err.startsWith('SessionNotFound') ||
      err.startsWith('CONTEXT_MISMATCH') ||
      err.startsWith('ContextMismatch') ||
      err.includes('session stream does not exist') ||
      err.includes('session does not belong')
    );
  }
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (
      code === 'SessionNotFound' ||
      code === 'SESSION_NOT_FOUND' ||
      code === 'ContextMismatch' ||
      code === 'CONTEXT_MISMATCH'
    ) {
      return true;
    }
    const messageKey = (err as { messageKey?: unknown }).messageKey;
    if (messageKey === 'error.sessionNotFound' || messageKey === 'error.contextMismatch') {
      return true;
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
      return isSessionMissingOrMismatched(message);
    }
  }
  return false;
}

/// Resolve authoritative selection from the backend bootstrap state and acquire
/// a durable session identity (resuming a validated preference, recovering existing project
/// sessions, or creating a new session with idempotent request identity).
export async function resolveAuthoritativeSession(
  backend: ConversationBackend,
  isStale: () => boolean = () => false,
): Promise<ScopeResolutionOutcome> {
  let snapshot: BootstrapSnapshot;
  try {
    snapshot = await backend.getBootstrapState();
  } catch (err) {
    if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
    return {
      kind: 'error',
      message: i18n.t('conversation.retryConnectivity', {
        message: err instanceof Error ? err.message : i18n.t('conversation.bootstrapFailed'),
      }),
    };
  }

  if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };

  if (!snapshot.isInitialized || !snapshot.activeWorkspaceId) {
    return { kind: 'needs-workspace', activeWorkspaceId: snapshot.activeWorkspaceId };
  }
  if (!snapshot.activeProjectId) {
    return { kind: 'needs-project', activeWorkspaceId: snapshot.activeWorkspaceId };
  }

  const ws = snapshot.activeWorkspaceId;
  const proj = snapshot.activeProjectId;
  const instId = snapshot.installationId ?? null;

  // 1. Check dedicated durable session preference for (installation, workspace, project)
  if (instId) {
    const pref = readDurableSessionPreference(instId, ws, proj);
    if (pref) {
      try {
        await backend.getConversation(ws, proj, pref.sessionId);
        if (isStale())
          return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
        return {
          kind: 'resumed',
          context: {
            workspaceId: ws,
            projectId: proj,
            sessionId: pref.sessionId,
            installationId: instId,
          },
        };
      } catch (err) {
        if (isStale())
          return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
        if (isSessionMissingOrMismatched(err)) {
          // Stored preference is explicitly missing or mismatched: invalidate preference.
          clearDurableSessionPreference(instId, ws, proj);
        } else {
          // Other errors (e.g. storage unavailable, transient failures) remain errors,
          // not evidence that the preference is invalid.
          const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
          return {
            kind: 'error',
            message: i18n.t('conversation.retryConnectivity', {
              message: rawMsg ?? i18n.t('conversation.historyNotLoaded'),
            }),
          };
        }
      }
    }
  }

  // 2. Active session cache check
  const cached = readSessionCache();
  if (cached && cached.workspaceId === ws && cached.projectId === proj) {
    return { kind: 'resumed', context: cached };
  }
  if (cached && !isStale()) {
    removeStorage(SESSION_CACHE_KEY);
  }

  // 3. Existing-session recovery: discover existing project sessions through backend
  if (backend.listSessions) {
    let list: { sessions: Array<{ sessionId: string; title: string | null; createdAt: string }> };
    try {
      list = await backend.listSessions({ workspaceId: ws, projectId: proj });
    } catch (err) {
      if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
      const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
      return {
        kind: 'error',
        message: isDefinitePreEffectRejection(err)
          ? (rawMsg ?? rejectionMessage(err))
          : i18n.t('conversation.retryConnectivity', {
              message: rawMsg ?? i18n.t('conversation.discoveryFailed'),
            }),
      };
    }
    if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
    const firstSession = list.sessions[0];
    if (firstSession) {
      const mostRecent = firstSession.sessionId;
      try {
        await backend.getConversation(ws, proj, mostRecent);
      } catch (err) {
        if (isStale())
          return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
        const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
        return {
          kind: 'error',
          message: isDefinitePreEffectRejection(err)
            ? (rawMsg ?? rejectionMessage(err))
            : i18n.t('conversation.retryConnectivity', {
                message: rawMsg ?? i18n.t('conversation.historyNotLoaded'),
              }),
        };
      }
      if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
      if (instId) {
        writeDurableSessionPreference({
          installationId: instId,
          workspaceId: ws,
          projectId: proj,
          sessionId: mostRecent,
        });
      }
      return {
        kind: 'resumed',
        context: {
          workspaceId: ws,
          projectId: proj,
          sessionId: mostRecent,
          ...(instId ? { installationId: instId } : {}),
        },
      };
    }

    return {
      kind: 'ready-no-session',
      context: {
        workspaceId: ws,
        projectId: proj,
        sessionId: null,
        ...(instId ? { installationId: instId } : {}),
      },
    };
  }

  if (isStale()) return { kind: 'error', message: i18n.t('conversation.bootstrapSuperseded') };
  return {
    kind: 'error',
    message: i18n.t('conversation.discoveryUnavailable'),
  };
}

export type SubmitOutcome = { ok: true } | { ok: false; error: string; uncertain: boolean };

export const conversationCapabilities = {
  submitMessage: true,
  execution: false,
  stop: true,
} as const;

/**
 * UI-normalized terminal lifecycle of an assistant turn. The wire carries
 * the core `MessageCompletionV1` shape; the UI works with a flat state so
 * labels never depend on string matching at render time.
 */
export type UiCompletion =
  | { state: 'completed'; truncated: boolean }
  | { state: 'interrupted' }
  | { state: 'failed' };

const normalizeCompletion = (
  completion: { Completed: { truncated: boolean } } | 'Interrupted' | 'Failed' | null | undefined,
): UiCompletion | null => {
  if (completion === null || completion === undefined) return null;
  if (completion === 'Interrupted') return { state: 'interrupted' };
  if (completion === 'Failed') return { state: 'failed' };
  return { state: 'completed', truncated: completion.Completed.truncated === true };
};

export const toUiMessage = (dto: {
  messageId: string;
  role?: string;
  text: string;
  createdAt: string;
  completion?: { Completed: { truncated: boolean } } | 'Interrupted' | 'Failed' | null;
}): {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  completion: UiCompletion | null;
} => ({
  id: dto.messageId,
  role: dto.role ?? 'user',
  text: dto.text,
  createdAt: dto.createdAt,
  completion: normalizeCompletion(dto.completion),
});

export const switchUnresolved = (
  req: ConversationContext | null,
  curId: string | null | undefined,
): Extract<SubmitOutcome, { ok: false }> | null =>
  req && req.sessionId !== curId
    ? {
        ok: false,
        error: i18n.t('conversation.switchPending'),
        uncertain: false,
      }
    : null;
