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

export type BootstrapSnapshot = {
  isInitialized: boolean;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
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
}

export type ConversationContext = {
  workspaceId: string;
  projectId: string;
  sessionId: string;
};

export type ScopeResolutionOutcome =
  | { kind: 'needs-workspace'; activeWorkspaceId: string | null }
  | { kind: 'needs-project'; activeWorkspaceId: string }
  | { kind: 'resumed'; context: ConversationContext }
  | { kind: 'created'; context: ConversationContext }
  | { kind: 'error'; message: string };

/// Resolve authoritative selection from the backend bootstrap state and acquire
/// a durable session identity (resuming a cached session matching the active scope
/// or creating a new session with an idempotent request identity).
export async function resolveAuthoritativeSession(
  backend: ConversationBackend,
): Promise<ScopeResolutionOutcome> {
  let snapshot: BootstrapSnapshot;
  try {
    snapshot = await backend.getBootstrapState();
  } catch (err) {
    return {
      kind: 'error',
      message: `${err instanceof Error ? err.message : 'Bootstrap state failed to load.'} Retry once connectivity returns.`,
    };
  }

  if (!snapshot.isInitialized || !snapshot.activeWorkspaceId) {
    return { kind: 'needs-workspace', activeWorkspaceId: snapshot.activeWorkspaceId };
  }
  if (!snapshot.activeProjectId) {
    return { kind: 'needs-project', activeWorkspaceId: snapshot.activeWorkspaceId };
  }

  const ws = snapshot.activeWorkspaceId;
  const proj = snapshot.activeProjectId;

  const cached = readSessionCache();
  if (cached && cached.workspaceId === ws && cached.projectId === proj) {
    return { kind: 'resumed', context: cached };
  }
  if (cached) {
    removeStorage(SESSION_CACHE_KEY);
  }

  try {
    let intent = readCreateIntent(ws, proj);
    if (!intent) {
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
      if (isDefinitePreEffectRejection(err)) removeStorage(CREATE_INTENT_KEY);
      throw err;
    }

    const ctx: ConversationContext = {
      workspaceId: ws,
      projectId: proj,
      sessionId: session.sessionId,
    };

    if (writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx))) {
      removeStorage(CREATE_INTENT_KEY);
    }
    return { kind: 'created', context: ctx };
  } catch (err) {
    if (isDefinitePreEffectRejection(err)) {
      return { kind: 'error', message: rejectionMessage(err) };
    }
    return {
      kind: 'error',
      message: `${err instanceof Error ? err.message : 'Conversation failed to start.'} Reload or retry once connectivity returns.`,
    };
  }
}
