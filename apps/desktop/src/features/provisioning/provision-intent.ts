/// Frozen workspace/project provisioning intent: request identity + payload
/// frozen BEFORE dispatch so an uncertain retry reuses both instead of
/// forking a duplicate workspace or project. Mirrors the PendingSend
/// discipline. The workspace language rides along frozen: a retry after a
/// language switch must replay the identical request fingerprint or the
/// backend reports a conflict.
import { readStorage, removeStorage, writeStorage } from '@/shared/lib/session-storage';

export interface ProvisionIntent {
  requestId: string;
  name: string;
  workspaceId?: string | undefined;
  preferredLanguage?: string | undefined;
}

// Storage keys are persisted formats — never rename without a migration.
export const PROVISION_WS_KEY = 'adham:provision:workspace';
export const PROVISION_PROJ_KEY = 'adham:provision:project';

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
        preferredLanguage:
          typeof parsed.preferredLanguage === 'string' ? parsed.preferredLanguage : undefined,
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
