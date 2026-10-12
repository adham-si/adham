/**
 * Dedicated durable session-selection storage containing technical IDs only.
 *
 * Scoped strictly to installation ID + workspace ID + project ID so different
 * profiles, databases, or scopes can never cross-pollinate session selections.
 *
 * Backed directly by persistent window.localStorage: failure to persist
 * (e.g. quota, disabled storage) returns false / null rather than silently
 * falling back to ephemeral sessionStorage.
 */

import { SESSION_CACHE_KEY, writeStorage } from './conversation-identity';

export interface DurableSessionPreference {
  installationId: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
}

export function buildSessionSelectionKey(
  installationId: string,
  workspaceId: string,
  projectId: string,
): string {
  return `adham:session:selected:${installationId}:${workspaceId}:${projectId}`;
}

export function readDurableSessionPreference(
  installationId: string,
  workspaceId: string,
  projectId: string,
): DurableSessionPreference | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const key = buildSessionSelectionKey(installationId, workspaceId, projectId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DurableSessionPreference>;
    if (
      typeof parsed.installationId === 'string' &&
      typeof parsed.workspaceId === 'string' &&
      typeof parsed.projectId === 'string' &&
      typeof parsed.sessionId === 'string' &&
      parsed.installationId === installationId &&
      parsed.workspaceId === workspaceId &&
      parsed.projectId === projectId &&
      parsed.sessionId.trim().length > 0
    ) {
      return {
        installationId: parsed.installationId,
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

export function writeDurableSessionPreference(preference: DurableSessionPreference): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    if (
      !preference.sessionId ||
      typeof preference.sessionId !== 'string' ||
      preference.sessionId.trim().length === 0
    ) {
      return false;
    }
    const key = buildSessionSelectionKey(
      preference.installationId,
      preference.workspaceId,
      preference.projectId,
    );
    const data: DurableSessionPreference = {
      installationId: preference.installationId,
      workspaceId: preference.workspaceId,
      projectId: preference.projectId,
      sessionId: preference.sessionId,
    };
    window.localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearDurableSessionPreference(
  installationId: string,
  workspaceId: string,
  projectId: string,
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const key = buildSessionSelectionKey(installationId, workspaceId, projectId);
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isDurableSessionStorageAvailable(): boolean {
  try {
    return (
      typeof window !== 'undefined' && 'localStorage' in window && window.localStorage !== null
    );
  } catch {
    return false;
  }
}

export function persistAndAnnounceActiveSession(
  ctx: {
    workspaceId: string;
    projectId: string;
    sessionId: string | null;
    title?: string | null;
  },
  installationId?: string | null,
): boolean {
  if (!ctx.sessionId) return true;
  writeStorage(SESSION_CACHE_KEY, JSON.stringify(ctx));
  let durableOk = true;
  if (installationId) {
    durableOk = writeDurableSessionPreference({
      installationId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
    });
  }
  try {
    window.dispatchEvent(
      new CustomEvent('adham:session-active', {
        detail: {
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
          title: ctx.title ?? null,
        },
      }),
    );
  } catch {
    // ignore
  }
  return durableOk;
}
