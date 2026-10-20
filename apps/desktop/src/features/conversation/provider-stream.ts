import * as React from 'react';
import type { ProviderAccountDto, ProviderModelDto } from '@adham/contracts-generated';
import { adhamClient } from '@/shared/api/adham-client';
import { onProvidersChanged } from '@/shared/providers/provider-events';

/**
 * Read-only seam for provider listing (settings-driven composer models).
 * Dispatch lives on ConversationBackend (completeOnceStreaming / stop);
 * this seam never opens a socket.
 */
export interface ProviderBackend {
  listAccounts(): Promise<{ accounts: ProviderAccountDto[] }>;
  listModels(
    context: { workspaceId: string; projectId: string; sessionId: string | null },
    accountId: string,
  ): Promise<{ models: ProviderModelDto[] }>;
}

/** IPC adapter: mirrors the A5/A6 client surface. */
export const adhamProviderBackend: ProviderBackend = {
  listAccounts: () => adhamClient.listProviderAccounts(),
  listModels: (context, accountId) =>
    adhamClient.listProviderModels(accountId, {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      sessionId: context.sessionId,
    }),
};

export interface OllamaPicker {
  /** First local Ollama account, or null when none is connected. */
  account: ProviderAccountDto | null;
  /** Pinned registry models for that account; empty before discovery. */
  models: ProviderModelDto[];
  /** True once the account list has resolved (found or empty). Until then a
   *  missing model must not be reported as "no provider". */
  accountsLoaded: boolean;
  /** True once this account's model list has resolved. Until then an empty
   *  list is "not known yet", not "none exist". */
  modelsLoaded: boolean;
  /** True only with a connected account and at least one pinned model. */
  ready: boolean;
}

/**
 * Lists the persisted Ollama account and its pinned models. Failures stay
 * unresolved — never an empty claim — and the composer keeps its honest
 * text-only path saying only what is known.
 */
export function useOllamaProvider({
  backend = adhamProviderBackend,
  context,
  enabled,
}: {
  backend?: ProviderBackend;
  context: { workspaceId: string; projectId: string; sessionId: string | null } | null;
  enabled: boolean;
}): OllamaPicker {
  const [accounts, setAccounts] = React.useState<ProviderAccountDto[] | null>(null);
  const [models, setModels] = React.useState<ProviderModelDto[] | null>(null);
  const [refreshSeq, setRefreshSeq] = React.useState(0);
  const fetchRef = React.useRef(0);

  // A settings mutation bumps the sequence so both reads below re-run: the
  // composer never keeps a pre-connection "no provider" claim.
  React.useEffect(() => onProvidersChanged(() => setRefreshSeq((seq) => seq + 1)), []);

  React.useEffect(() => {
    if (!enabled) {
      setAccounts(null);
      return;
    }
    const fetchSeq = ++fetchRef.current;
    let stale = false;
    backend
      .listAccounts()
      .then((data) => {
        if (!stale && fetchSeq === fetchRef.current) setAccounts(data.accounts);
      })
      .catch(() => {
        // Left unresolved on failure: an unreachable list is "not known yet",
        // never proof that no provider is connected.
      });
    return () => {
      stale = true;
    };
  }, [backend, enabled, refreshSeq]);

  const account = accounts?.find((a) => a.privacyClass === 'local_only') ?? null;

  React.useEffect(() => {
    if (!enabled || !account || !context) {
      setModels(null);
      return;
    }
    const fetchSeq = ++fetchRef.current;
    let stale = false;
    backend
      .listModels(context, account.accountId)
      .then((data) => {
        if (!stale && fetchSeq === fetchRef.current) setModels(data.models);
      })
      .catch(() => {
        // Same rule as accounts: a failed list is unresolved, not empty.
      });
    return () => {
      stale = true;
    };
    // Scope fields, not the context object: callers pass a fresh literal per
    // render, and an identity dep would refetch (and re-render) forever.
    // `refreshSeq` is intentionally absent: a provider-changed bump re-lists
    // accounts, and the new account identity re-runs this effect (bumping here
    // too would invalidate the account fetch's shared sequence).
  }, [backend, enabled, account, context?.workspaceId, context?.projectId, context?.sessionId]);

  return {
    account,
    models: models ?? [],
    accountsLoaded: accounts !== null,
    modelsLoaded: models !== null,
    ready: account !== null && models !== null && models.length > 0,
  };
}
