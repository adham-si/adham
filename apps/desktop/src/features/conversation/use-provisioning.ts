import * as React from 'react';
import { adhamClient } from '@/shared/api/adham-client';
import type { ProjectSummary, WorkspaceSummary } from '@adham/contracts-generated';
import {
  clearProjectIntent,
  clearWorkspaceIntent,
  isDefinitePreEffectRejection,
  readProjectIntent,
  readWorkspaceIntent,
  rejectionMessage,
  writeProjectIntent,
  writeWorkspaceIntent,
} from './conversation-identity';

/// Minimal backend surface for deliberate provisioning. Mirrors the optional
/// stable-request-ID support of the session/message commands.
export interface ProvisioningBackend {
  createWorkspace(
    payload: { name: string; kind: string; preferredLanguage: string },
    options?: { requestId?: string },
  ): Promise<WorkspaceSummary>;
  createProject(
    workspaceId: string,
    payload: { name: string; storageKind: string },
    options?: { requestId?: string },
  ): Promise<ProjectSummary>;
}

export type ProvisionOutcome =
  | { ok: true; id: string }
  | { ok: false; error: string; uncertain: boolean };

const WORKSPACE_KIND = 'personal';
const PROJECT_STORAGE_KIND = 'isolated';

/**
 * Deliberate, retry-safe workspace/project provisioning. Nothing dispatches
 * on mount: every creation starts from an explicit user action with its
 * request identity frozen in storage BEFORE dispatch, so an uncertain retry
 * reuses the same ID and payload instead of forking a duplicate. A
 * workspace success followed by a project failure resumes at project
 * creation — the issued workspace ID is kept, never recreated.
 */
export function useProvisioning({
  backend = adhamClient,
}: {
  backend?: ProvisioningBackend | undefined;
} = {}) {
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const workingRef = React.useRef(false);

  const run = React.useCallback(
    async (
      kind: 'workspace' | 'project',
      name: string,
      boundWorkspaceId: string | null,
    ): Promise<ProvisionOutcome> => {
      const trimmed = name.trim();
      if (!trimmed) {
        return { ok: false, error: 'Name must not be empty.', uncertain: false };
      }
      if (workingRef.current) {
        return { ok: false, error: 'Provisioning already in progress.', uncertain: false };
      }
      workingRef.current = true;
      setWorking(true);
      setError(null);
      try {
        const readIntent = kind === 'workspace' ? readWorkspaceIntent : readProjectIntent;
        const writeIntent = kind === 'workspace' ? writeWorkspaceIntent : writeProjectIntent;
        const clearIntent = kind === 'workspace' ? clearWorkspaceIntent : clearProjectIntent;
        const frozen = readIntent();
        // A frozen intent for different input blocks: retrying under a new
        // name while the previous outcome is unknown would fork a duplicate.
        if (
          frozen &&
          (frozen.name !== trimmed || frozen.workspaceId !== (boundWorkspaceId ?? undefined))
        ) {
          const message =
            'A previous provisioning attempt has an unknown status. Retry it before starting another.';
          setError(message);
          return { ok: false, error: message, uncertain: true };
        }
        const intent = frozen ?? {
          requestId: crypto.randomUUID(),
          name: trimmed,
          workspaceId: boundWorkspaceId ?? undefined,
        };
        if (!frozen && !writeIntent(intent)) {
          const message = 'Provisioning identity could not be recorded. Nothing was sent.';
          setError(message);
          return { ok: false, error: message, uncertain: false };
        }
        try {
          let id: string;
          if (kind === 'workspace') {
            id = (
              await backend.createWorkspace(
                { name: trimmed, kind: WORKSPACE_KIND, preferredLanguage: 'en' },
                { requestId: intent.requestId },
              )
            ).workspaceId;
          } else {
            if (!boundWorkspaceId) {
              const message = 'Create a workspace first.';
              setError(message);
              return { ok: false, error: message, uncertain: false };
            }
            id = (
              await backend.createProject(
                boundWorkspaceId,
                { name: trimmed, storageKind: PROJECT_STORAGE_KIND },
                { requestId: intent.requestId },
              )
            ).projectId;
          }
          clearIntent();
          if (kind === 'workspace') setWorkspaceId(id);
          return { ok: true, id };
        } catch (err) {
          // Proven pre-effect: nothing was stored, the identity is spent.
          // Anything else keeps the frozen intent for a same-input retry.
          if (isDefinitePreEffectRejection(err)) {
            clearIntent();
            const message = rejectionMessage(err);
            setError(message);
            return { ok: false, error: message, uncertain: false };
          }
          const message = err instanceof Error ? err.message : 'Provisioning did not complete.';
          setError(`${message} Retry with the same name before starting another.`);
          return { ok: false, error: message, uncertain: true };
        }
      } finally {
        workingRef.current = false;
        setWorking(false);
      }
    },
    [backend],
  );

  const createWorkspace = React.useCallback((name: string) => run('workspace', name, null), [run]);
  const createProject = React.useCallback(
    (name: string, wsId: string | null) => run('project', name, wsId),
    [run],
  );
  const adoptWorkspace = React.useCallback((id: string) => setWorkspaceId(id), []);

  return { workspaceId, working, error, createWorkspace, createProject, adoptWorkspace };
}
