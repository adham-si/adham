/// Frozen selection intent: one unresolved selection at a time. A different
/// scope is blocked (not dispatched) while one is frozen; the same scope
/// retries with the frozen identity so a delayed original replays instead
/// of forking. Mounts and reloads never auto-replay it — only an explicit
/// same-scope retry dispatches.
import { readStorage, removeStorage, writeStorage } from '@/shared/lib/session-storage';

export interface SelectIntent {
  requestId: string;
  workspaceId: string;
  projectId: string;
}

// Storage key is a persisted format — never rename without a migration.
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
