/// Command-identity and session-storage helpers for the conversation
/// controller. Kept separate so the hook file stays reviewable.

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

/// Codes the backend provably emits before any effect is applied.
/// STORAGE_UNAVAILABLE and unknown errors are NOT proof of rollback —
/// commit-failure handling returns storage failures when commit certainty
/// or receipt reads are unavailable. Only whitelisted pre-effect
/// rejections are definite; unknowns retain the logical command identity.
const PRE_EFFECT_REJECTION_CODES = new Set([
  'VALIDATION_FAILED',
  'INVALID_COMMAND_VERSION',
  'REQUEST_ID_CONFLICT',
  'CONTEXT_MISMATCH',
  'SESSION_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'WORKSPACE_NOT_FOUND',
]);

/// Un-prefixed validation strings the handlers emit before any effect.
const PRE_EFFECT_REJECTION_MESSAGES = new Set([
  'workspaceId context required',
  'projectId context required',
  'sessionId context required',
]);

function stringIsPreEffectRejection(err: string): boolean {
  if (PRE_EFFECT_REJECTION_MESSAGES.has(err)) return true;
  const colon = err.indexOf(':');
  if (colon <= 0) return false;
  return PRE_EFFECT_REJECTION_CODES.has(err.slice(0, colon));
}

/// A definite pre-effect rejection: the command provably was not applied,
/// so its logical identity is spent. Everything else — storage
/// unavailable, repair required, unknown codes, transport failures —
/// leaves the outcome unknown and the identity must be retained.
export function isDefinitePreEffectRejection(err: unknown): boolean {
  if (typeof err === 'string') return stringIsPreEffectRejection(err);
  if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && PRE_EFFECT_REJECTION_CODES.has(code)) return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && PRE_EFFECT_REJECTION_MESSAGES.has(message)) return true;
  }
  return false;
}

export function rejectionMessage(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  if (err instanceof Error) return err.message;
  return 'Message was not saved.';
}

export const SESSION_CACHE_KEY = 'adham:compose:session';
export const CREATE_INTENT_KEY = 'adham:compose:create-intent';
const PENDING_SEND_KEY = 'adham:compose:pending-send';

export function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore: caching is best-effort, correctness never depends on it
  }
}

export function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

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

export function writePendingSend(record: PendingSend): void {
  writeStorage(PENDING_SEND_KEY, JSON.stringify(record));
}

export function removePendingSend(): void {
  removeStorage(PENDING_SEND_KEY);
}

export function sameScope(a: ConversationScope, b: ConversationScope): boolean {
  return (
    a.workspaceId === b.workspaceId && a.projectId === b.projectId && a.sessionId === b.sessionId
  );
}
