import type { ConversationMessageDto } from '@/shared/api/adham-client';
import {
  CREATE_INTENT_KEY,
  SESSION_CACHE_KEY,
  isDefinitePreEffectRejection,
  readCreateIntent,
  readSessionCache,
  rejectionMessage,
  removeStorage,
  writeStorage,
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
}

export type ConversationContext = {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  installationId?: string | null;
};

export type ScopeResolutionOutcome =
  | { kind: 'needs-workspace'; activeWorkspaceId: string | null }
  | { kind: 'needs-project'; activeWorkspaceId: string }
  | { kind: 'resumed'; context: ConversationContext }
  | { kind: 'created'; context: ConversationContext }
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
    if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
    return {
      kind: 'error',
      message: `${err instanceof Error ? err.message : 'Bootstrap state failed to load.'} Retry once connectivity returns.`,
    };
  }

  if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };

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
        if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
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
        if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
        if (isSessionMissingOrMismatched(err)) {
          // Stored preference is explicitly missing or mismatched: invalidate preference.
          clearDurableSessionPreference(instId, ws, proj);
        } else {
          // Other errors (e.g. storage unavailable, transient failures) remain errors,
          // not evidence that the preference is invalid.
          const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
          return {
            kind: 'error',
            message: `${rawMsg ?? 'Saved conversation could not be loaded.'} Retry once connectivity returns.`,
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
      if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
      const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
      return {
        kind: 'error',
        message: isDefinitePreEffectRejection(err)
          ? (rawMsg ?? rejectionMessage(err))
          : `${rawMsg ?? 'Session discovery failed.'} Retry once connectivity returns.`,
      };
    }
    if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
    const firstSession = list.sessions[0];
    if (firstSession) {
      const mostRecent = firstSession.sessionId;
      try {
        await backend.getConversation(ws, proj, mostRecent);
      } catch (err) {
        if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
        const rawMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
        return {
          kind: 'error',
          message: isDefinitePreEffectRejection(err)
            ? (rawMsg ?? rejectionMessage(err))
            : `${rawMsg ?? 'Saved conversation could not be loaded.'} Retry once connectivity returns.`,
        };
      }
      if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
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
  }

  if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };

  try {
    let intent = readCreateIntent(ws, proj);
    if (!intent) {
      if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
      intent = { requestId: crypto.randomUUID(), workspaceId: ws, projectId: proj };
      if (!writeStorage(CREATE_INTENT_KEY, JSON.stringify(intent))) {
        return {
          kind: 'error',
          message:
            'Session creation identity could not be recorded. Retry once storage is available.',
        };
      }
    }

    let session: SessionSnapshot;
    try {
      session = await backend.createSession(
        ws,
        proj,
        { title: null },
        { requestId: intent.requestId },
      );
    } catch (err) {
      if (isDefinitePreEffectRejection(err) && !isStale()) {
        const stored = readCreateIntent(ws, proj);
        if (stored?.requestId === intent.requestId) {
          removeStorage(CREATE_INTENT_KEY);
        }
      }
      throw err;
    }

    if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };

    const ctx: ConversationContext = {
      workspaceId: ws,
      projectId: proj,
      sessionId: session.sessionId,
      ...(instId ? { installationId: instId } : {}),
    };

    if (instId) {
      writeDurableSessionPreference({
        installationId: instId,
        workspaceId: ws,
        projectId: proj,
        sessionId: session.sessionId,
      });
    }

    if (writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx))) {
      const stored = readCreateIntent(ws, proj);
      if (stored?.requestId === intent.requestId) {
        removeStorage(CREATE_INTENT_KEY);
      }
    }
    return { kind: 'created', context: ctx };
  } catch (err) {
    if (isStale()) return { kind: 'error', message: 'Bootstrap superseded.' };
    if (isDefinitePreEffectRejection(err)) {
      return { kind: 'error', message: rejectionMessage(err) };
    }
    return {
      kind: 'error',
      message: `${err instanceof Error ? err.message : 'Conversation failed to start.'} Reload or retry once connectivity returns.`,
    };
  }
}
