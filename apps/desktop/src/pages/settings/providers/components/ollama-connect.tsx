import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

type ConnectState = 'idle' | 'testing' | 'unreachable' | 'connected';

/**
 * Working Ollama row for Delivery A: endpoint + Test + Discover. A failed
 * test persists nothing — the account is minted only after a reachability
 * probe succeeds. Everything else on the Providers page stays a disabled
 * catalog preview.
 */
export function OllamaConnect() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const saved = accountsQuery.data?.accounts.find((a) => a.privacyClass === 'local_only') ?? null;
  const [editedEndpoint, setEditedEndpoint] = React.useState<string | null>(null);
  const [state, setState] = React.useState<ConnectState>('idle');
  const [pinnedCount, setPinnedCount] = React.useState<number | null>(null);

  const value = editedEndpoint ?? saved?.endpointUrl ?? '';
  const dirty = saved !== null && editedEndpoint !== null && editedEndpoint !== saved.endpointUrl;
  const working = state === 'testing';

  const handleTest = async () => {
    if (working || !value.trim()) return;
    setState('testing');
    try {
      // Unsaved/changed endpoints probe transiently ("failed test saves
      // nothing"): the empty accountId makes the backend skip persistence.
      const health =
        !saved || dirty
          ? await adhamClient.testProviderConnection('', undefined, { endpointUrl: value })
          : await adhamClient.testProviderConnection(saved.accountId);
      if (!health.reachable) {
        setState('unreachable');
        return;
      }
      let accountId = saved?.accountId;
      if (!accountId || dirty) {
        const account = await adhamClient.updateProviderAccount(
          {
            accountId: accountId ?? null,
            alias: t('settings.providers.ollamaAlias'),
            endpointUrl: value,
          },
          {},
        );
        accountId = account.accountId;
      }
      const models = await adhamClient.discoverOllamaModels(accountId);
      setPinnedCount(models.models.length);
      setState('connected');
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(accountId) });
      await accountsQuery.refetch();
    } catch {
      setState('unreachable');
    }
  };

  const handleDiscover = async () => {
    if (!saved || working) return;
    setState('testing');
    try {
      const models = await adhamClient.discoverOllamaModels(saved.accountId);
      setPinnedCount(models.models.length);
      setState('connected');
    } catch {
      setState('connected');
    }
  };

  return (
    <section aria-labelledby="ollama-connect-heading" className="space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <h3 id="ollama-connect-heading" className="text-sm font-semibold text-foreground">
          {t('settings.providers.ollamaSectionTitle')}
        </h3>
        <span className="text-xs text-foreground-secondary">
          {t('settings.providers.localOnlyBadge')}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          aria-label={t('settings.providers.endpointLabel')}
          placeholder={t('settings.providers.endpointPlaceholder')}
          value={value}
          onChange={(e) => setEditedEndpoint(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={working || value.trim().length === 0}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {working ? t('settings.providers.testing') : t('settings.providers.testConnection')}
        </button>
        <button
          type="button"
          onClick={() => void handleDiscover()}
          disabled={working || saved === null}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('settings.providers.discoverModels')}
        </button>
      </div>

      <div aria-live="polite" className="text-xs text-foreground-secondary">
        {state === 'connected' && saved !== null && (
          <p>
            {t('settings.providers.saved')}{' '}
            {pinnedCount !== null && (
              <span className="font-medium text-foreground">
                {t('settings.providers.discoveredCount', { count: pinnedCount })}
              </span>
            )}
          </p>
        )}
        {state === 'unreachable' && (
          <p role="alert">{t('settings.providers.unreachable', { url: value })}</p>
        )}
      </div>
    </section>
  );
}
