/// A frozen logical command whose outcome is unknown. Carries the full
/// scope plus payload and request identity so retries and remounts replay
/// the exact command instead of minting a duplicate under another text or
/// scope. Persisted in sessionStorage until resolved.
import i18n from '@/shared/i18n';
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

/// Actual Tauri IPC public codes (Rust PublicErrorCode serializes without
/// rename_all, e.g. InvalidRequest). from_error_str maps VALIDATION_FAILED
/// to InvalidRequest with messageKey error.validationFailed. Both shapes
/// are definite; storage/unknown codes stay uncertain.
const PUBLIC_PRE_EFFECT_CODES = new Set([
  'InvalidRequest',
  'InvalidProtocolVersion',
  'WorkspaceNotFound',
  'ProjectNotFound',
  'SessionNotFound',
  'ContextMismatch',
  'RequestIdConflict',
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
  const prefix = err.slice(0, colon);
  return PRE_EFFECT_REJECTION_CODES.has(prefix) || PUBLIC_PRE_EFFECT_CODES.has(prefix);
}

/// A definite pre-effect rejection: the command provably was not applied,
/// so its logical identity is spent. Everything else — storage
/// unavailable, repair required, unknown codes, transport failures —
/// leaves the outcome unknown and the identity must be retained.
export function isDefinitePreEffectRejection(err: unknown): boolean {
  if (typeof err === 'string') return stringIsPreEffectRejection(err);
  if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
    const code = (err as { code?: unknown }).code;
    if (
      typeof code === 'string' &&
      (PRE_EFFECT_REJECTION_CODES.has(code) || PUBLIC_PRE_EFFECT_CODES.has(code))
    )
      return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && PRE_EFFECT_REJECTION_MESSAGES.has(message)) return true;
  }
  return false;
}

/// English fallbacks for known public messageKeys. Rendered through the
/// existing i18n layer so a future translation replaces them; the fallback
/// keeps a rejected name correctable instead of frozen as uncertain.
const MESSAGE_KEY_FALLBACKS: Record<string, string> = {
  'error.validationFailed': 'This name is invalid. Correct it and try again.',
  'error.invalidProtocolVersion': 'This app version is unsupported. Update and try again.',
  'error.workspaceNotFound': 'Workspace was not found.',
  'error.projectNotFound': 'Project was not found.',
  'error.sessionNotFound': 'Session was not found.',
  'error.contextMismatch': 'Selection changed. Reload and try again.',
  'error.requestIdConflict': 'Conflicting request. Try again.',
};

export function rejectionMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const messageKey = (err as { messageKey?: unknown }).messageKey;
    if (typeof messageKey === 'string' && messageKey) {
      const rawMessage = (err as { message?: unknown }).message;
      const fallback =
        (typeof rawMessage === 'string' && rawMessage) ||
        MESSAGE_KEY_FALLBACKS[messageKey] ||
        messageKey;
      try {
        return i18n.t(messageKey, fallback);
      } catch {
        return fallback;
      }
    }
  }
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
export const PROVISION_WS_KEY = 'adham:provision:workspace';
export const PROVISION_PROJ_KEY = 'adham:provision:project';

export function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/// Returns false when the write could not be persisted. Callers that
/// freeze a logical command BEFORE dispatch must treat false as a hard
/// block: dispatching without a durable identity reopens the duplicate
/// window this record exists to close.
export function writeStorage(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
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

/// Frozen provisioning intent: request identity + payload frozen BEFORE
/// dispatch so an uncertain retry reuses both instead of forking a duplicate
/// workspace or project. Mirrors the PendingSend discipline.
export interface ProvisionIntent {
  requestId: string;
  name: string;
  workspaceId?: string | undefined;
}

function readProvisionIntent(key: string): ProvisionIntent | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProvisionIntent>;
    if (typeof parsed.requestId === 'string' && typeof parsed.name === 'string') {
      return {
        requestId: parsed.requestId,
        name: parsed.name,
        workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeProvisionIntent(key: string, intent: ProvisionIntent): boolean {
  return writeStorage(key, JSON.stringify(intent));
}

export const readWorkspaceIntent = (): ProvisionIntent | null =>
  readProvisionIntent(PROVISION_WS_KEY);
export const writeWorkspaceIntent = (intent: ProvisionIntent): boolean =>
  writeProvisionIntent(PROVISION_WS_KEY, intent);
export const clearWorkspaceIntent = (): void => removeStorage(PROVISION_WS_KEY);
export const readProjectIntent = (): ProvisionIntent | null =>
  readProvisionIntent(PROVISION_PROJ_KEY);
export const writeProjectIntent = (intent: ProvisionIntent): boolean =>
  writeProvisionIntent(PROVISION_PROJ_KEY, intent);
export const clearProjectIntent = (): void => removeStorage(PROVISION_PROJ_KEY);

/// Window event announcing a confirmed scope change (creation or
/// selection). Carries the confirmed step so the conversation surface can
/// hold exactly that step until authoritative bootstrap advances. The
/// conversation surface refreshes its scope on it and selection lists
/// re-read on it. Failures never dispatch it.
export const SCOPE_CHANGED_EVENT = 'adham:scope-changed';

export function announceScopeChanged(
  step: 'workspace' | 'project' = 'project',
  origin: 'created' | 'selected' = 'selected',
): void {
  try {
    window.dispatchEvent(new CustomEvent(SCOPE_CHANGED_EVENT, { detail: { step, origin } }));
  } catch {
    // ignore
  }
}

/// Frozen selection intent: one unresolved selection at a time. A different
/// scope is blocked (not dispatched) while one is frozen; the same scope
/// retries with the frozen identity so a delayed original replays instead
/// of forking. Mounts and reloads never auto-replay it — only an explicit
/// same-scope retry dispatches.
export interface SelectIntent {
  requestId: string;
  workspaceId: string;
  projectId: string;
}

const SELECT_INTENT_KEY = 'adham:select:intent';

export function readSelectIntent(): SelectIntent | null {
  const raw = readStorage(SELECT_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SelectIntent>;
    if (
      typeof parsed.requestId === 'string' &&
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string'
    ) {
      return {
        requestId: parsed.requestId,
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSelectIntent(intent: SelectIntent): boolean {
  return writeStorage(SELECT_INTENT_KEY, JSON.stringify(intent));
}

export function clearSelectIntent(): void {
  removeStorage(SELECT_INTENT_KEY);
}
