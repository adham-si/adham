/**
 * The explicit model choice for a conversation, renderer-local and technical
 * only (a model id — no identity or user content). Keyed by the same session
 * bucket drafts use, so switching sessions never carries one session's choice
 * into another. The stored id is a claim to revalidate, not a grant: discovery
 * decides whether it can still be applied, and a vanished id must be explained,
 * never silently replaced.
 */

const MODEL_PREFIX = 'adham:compose:model:';
const PENDING_BUCKET = 'pending';

function bucketKey(sessionId: string): string {
  return `${MODEL_PREFIX}${sessionId}`;
}

export function readComposeModelPreference(sessionId: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(bucketKey(sessionId));
    return raw ? raw : null;
  } catch {
    return null;
  }
}

export function writeComposeModelPreference(sessionId: string, modelId: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!modelId) return;
    window.localStorage.setItem(bucketKey(sessionId), modelId);
  } catch {
    // Private mode or blocked storage: the in-memory selection still drives the session.
  }
}

/**
 * Carry the pre-session choice into the session a first send materialized.
 * Only fills an empty bucket: an existing session's own explicit choice is
 * never overwritten by whatever was picked before that session existed.
 */
export function migratePendingModelChoice(
  nextSessionId: string,
  pendingBucket: string = PENDING_BUCKET,
): void {
  if (nextSessionId === pendingBucket) return;
  try {
    const pending = window.localStorage.getItem(bucketKey(pendingBucket));
    if (!pending) return;
    if (window.localStorage.getItem(bucketKey(nextSessionId))) return;
    window.localStorage.setItem(bucketKey(nextSessionId), pending);
    window.localStorage.removeItem(bucketKey(pendingBucket));
  } catch {
    // ignore: migration is best-effort, the in-memory selection is unaffected
  }
}
