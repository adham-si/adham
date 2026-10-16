/// Generic error-envelope helpers shared by every retry-aware caller
/// (conversation sends, provisioning, selection). These classify protocol
/// error shapes — codes and messageKeys from the backend envelope — and
/// render localized messages. Domain policy (which identity to retain or
/// spend) stays with each caller.
import i18n from '@/shared/i18n';

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
  return i18n.t('error.notSaved');
}
