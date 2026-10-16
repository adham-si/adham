/// Session/message identity and recovery for the conversation domain: the
/// frozen pending send, the durable session cache, the session-creation
/// intent, and the send-blocking rules. Workspace/project provisioning
/// intents, the selection intent, and the scope event live in the
/// provisioning feature; generic storage and error-envelope helpers live in
/// shared infrastructure.
import i18n from '@/shared/i18n';
import { readStorage, removeStorage, writeStorage } from '@/shared/lib/session-storage';
import { readSelectIntent } from '../provisioning';

/// A frozen logical command whose outcome is unknown. Carries the full
/// scope plus payload and request identity so retries and remounts replay
/// the exact command instead of minting a duplicate under another text or
/// scope. Persisted in sessionStorage until resolved.
export interface PendingSend {
  requestId: string;
  text: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

export const SESSION_CACHE_KEY = 'adham:compose:session';
export const CREATE_INTENT_KEY = 'adham:compose:create-intent';
const PENDING_SEND_KEY = 'adham:compose:pending-send';

export interface ConversationScope {
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

export function readSessionCache(): ConversationScope | null {
  const raw = readStorage(SESSION_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationScope>;
    if (
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string' &&
      typeof parsed.sessionId === 'string'
    ) {
      return {
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface CreateIntent {
  requestId: string;
  workspaceId: string;
  projectId: string;
}

export function readCreateIntent(workspaceId: string, projectId: string): CreateIntent | null {
  const raw = readStorage(CREATE_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CreateIntent>;
    if (
      typeof parsed.requestId === 'string' &&
      parsed.workspaceId === workspaceId &&
      parsed.projectId === projectId
    ) {
      return { requestId: parsed.requestId, workspaceId, projectId };
    }
    return null;
  } catch {
    return null;
  }
}

export function readPendingSend(): PendingSend | null {
  const raw = readStorage(PENDING_SEND_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSend>;
    if (
      typeof parsed.requestId === 'string' &&
      typeof parsed.text === 'string' &&
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string' &&
      typeof parsed.sessionId === 'string'
    ) {
      return parsed as PendingSend;
    }
    return null;
  } catch {
    return null;
  }
}

/// Returns false when the frozen record could not be persisted — the
/// caller must NOT dispatch in that case.
export function writePendingSend(record: PendingSend): boolean {
  return writeStorage(PENDING_SEND_KEY, JSON.stringify(record));
}

export function removePendingSend(): void {
  removeStorage(PENDING_SEND_KEY);
}

export function sameScope(a: ConversationScope, b: ConversationScope): boolean {
  return (
    a.workspaceId === b.workspaceId && a.projectId === b.projectId && a.sessionId === b.sessionId
  );
}

/// Definite send-block while a scope selection is unresolved: the send
/// would otherwise use the old scope. Nothing is dispatched, so the block
/// is definite, not uncertain. Returns the message, or null when sending
/// may proceed.
export function unresolvedSelectionMessage(): string | null {
  if (!readSelectIntent()) return null;
  return i18n.t('conversation.unresolvedSelection');
}

/// First applicable definite pre-send block: unresolved selection, then a
/// confirmed-but-unresolved scope change (creation/selection whose bootstrap
/// is still pending or failed). Both protect the retained old-scope context.
export function sendBlockedReason(scopeStale: boolean): string | null {
  return unresolvedSelectionMessage() ?? (scopeStale ? i18n.t('conversation.scopeChanging') : null);
}
