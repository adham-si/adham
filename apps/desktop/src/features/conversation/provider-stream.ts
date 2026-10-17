import * as React from 'react';
import type { ProviderAccountDto, ProviderModelDto } from '@adham/contracts-generated';
import { adhamClient } from '@/shared/api/adham-client';

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
  /** True only with a connected account and at least one pinned model. */
  ready: boolean;
}

/**
 * Lists the persisted Ollama account and its pinned models. Failures are
 * swallowed into the empty state: settings pages remain usable and the
 * composer stays in its honest text-only path.
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
  const fetchRef = React.useRef(0);

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
        if (!stale && fetchSeq === fetchRef.current) setAccounts([]);
      });
    return () => {
      stale = true;
    };
  }, [backend, enabled]);

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
        if (!stale && fetchSeq === fetchRef.current) setModels([]);
      });
    return () => {
      stale = true;
    };
  }, [backend, enabled, account, context]);

  return {
    account,
    models: models ?? [],
    ready: account !== null && models !== null && models.length > 0,
  };
}
