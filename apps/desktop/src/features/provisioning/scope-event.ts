/// Window event announcing a confirmed scope change (creation or
/// selection). Carries the confirmed step and, when known, the confirmed
/// scope IDs so every surface synchronizes without re-reading. The
/// conversation surface refreshes its authoritative scope on it and
/// selection lists re-read on creation. Failures never dispatch it.
export const SCOPE_CHANGED_EVENT = 'adham:scope-changed';

export interface ScopeChangedDetail {
  step: 'workspace' | 'project';
  origin: 'created' | 'selected';
  workspaceId: string | null;
  projectId: string | null;
}

export function announceScopeChanged(
  step: 'workspace' | 'project' = 'project',
  origin: 'created' | 'selected' = 'selected',
  scope: { workspaceId: string | null; projectId: string | null } | null = null,
): void {
  try {
    const detail: ScopeChangedDetail = {
      step,
      origin,
      workspaceId: scope?.workspaceId ?? null,
      projectId: scope?.projectId ?? null,
    };
    window.dispatchEvent(new CustomEvent(SCOPE_CHANGED_EVENT, { detail }));
  } catch {
    // ignore
  }
}
