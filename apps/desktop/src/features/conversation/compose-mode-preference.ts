/**
 * Last-used composer mode, renderer-local and technical only (no identity or
 * user content). 'execute' is never restored: it has no runtime to execute
 * under and is not selectable, so a stale value must not resurrect it.
 */

import type { ComposeMode } from '@/widgets/compose';

const MODE_KEY = 'adham:compose:mode';
const RESTORABLE: ComposeMode[] = ['ask', 'plan', 'code'];

export function readComposeModePreference(): ComposeMode | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(MODE_KEY);
    return raw !== null && (RESTORABLE as string[]).includes(raw) ? (raw as ComposeMode) : null;
  } catch {
    return null;
  }
}

export function writeComposeModePreference(mode: ComposeMode): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!(RESTORABLE as string[]).includes(mode)) return;
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the in-memory selection still drives the session.
  }
}
