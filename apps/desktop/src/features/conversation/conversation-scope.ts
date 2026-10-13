import i18n from '@/shared/i18n';
import type { ConversationMessageDto } from '@/shared/api/adham-client';
import {
  SESSION_CACHE_KEY,
  isDefinitePreEffectRejection,
  readSessionCache,
  rejectionMessage,
  removeStorage,
} from './conversation-identity';

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
  recordPendingOperation?(
    workspaceId: string,
    projectId: string,
    payload: import('@adham/contracts-generated').RecordPendingOperationPayload,
    options?: { requestId?: string; sessionId?: string | null },
  ): Promise<import('@adham/contracts-generated').PendingOperationDto>;
  listPendingOperations?(): Promise<import('@adham/contracts-generated').PendingOperationList>;
  clearPendingOperation?(
    payload: import('@adham/contracts-generated').ClearPendingOperationPayload,
    options?: { requestId?: string },
  ): Promise<void>;
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
  stop: false,
} as const;

export const toUiMessage = (dto: {
  messageId: string;
  role?: string;
  text: string;
  createdAt: string;
}): { id: string; role: string; text: string; createdAt: string } => ({
  id: dto.messageId,
  role: dto.role ?? 'user',
  text: dto.text,
  createdAt: dto.createdAt,
});

export const switchUnresolved = (
  req: ConversationContext | null,
  curId: string | null | undefined,
): SubmitOutcome | null =>
  req && req.sessionId !== curId
    ? {
        ok: false,
        error: i18n.t('conversation.switchPending'),
        uncertain: false,
      }
    : null;
