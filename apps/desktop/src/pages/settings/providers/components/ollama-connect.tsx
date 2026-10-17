import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * A check/discovery result is only ever rendered under the endpoint it was
 * made against; the guard comparison is the whole stale-attribution defense.
 * Nothing here is persisted: after a reopen the card shows the configured
 * account and the recorded inventory from the registry — explicitly not a
 * fresh health check.
 */
interface CheckResult {
  endpoint: string;
  at: number;
  reachable: boolean;
  tags: number | null;
}
interface DiscoveryResult {
  at: number;
  count: number;
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Working Ollama row for Delivery A: endpoint + Test + Discover. A failed
 * test persists nothing — the account is minted only after a reachability
 * probe succeeds. When the endpoint input differs from the saved account, the
 * last check/discovery stays hidden and Discover is locked: results must
 * never be attributed to an endpoint they did not run against.
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
  // Recorded inventory: restored on reopen straight from the registry read.
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(saved?.accountId ?? 'none'),
    queryFn: () => adhamClient.listProviderModels(saved!.accountId),
    enabled: saved !== null,
    staleTime: 60_000,
    retry: false,
  });

  const [editedEndpoint, setEditedEndpoint] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [check, setCheck] = React.useState<CheckResult | null>(null);
  const [discovery, setDiscovery] = React.useState<DiscoveryResult | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  const value = editedEndpoint ?? saved?.endpointUrl ?? '';
  const current = value.trim();
  const dirty = saved !== null && editedEndpoint !== null && editedEndpoint !== saved.endpointUrl;
  const checkCurrent = check !== null && check.endpoint === current;
  const models = modelsQuery.data?.models ?? [];

  const handleTest = async () => {
    if (busy || !current) return;
    setBusy(true);
    setProbeError(null);
    try {
      // Unsaved/changed endpoints probe transiently ("failed test saves
      // nothing"): the empty accountId makes the backend skip persistence.
      const health =
        !saved || dirty
          ? await adhamClient.testProviderConnection('', undefined, { endpointUrl: value })
          : await adhamClient.testProviderConnection(saved.accountId);
      if (!health.reachable) {
        setCheck({ endpoint: current, at: Date.now(), reachable: false, tags: null });
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
      const modelsList = await adhamClient.discoverOllamaModels(accountId);
      setCheck({ endpoint: current, at: Date.now(), reachable: true, tags: health.modelTagCount });
      setDiscovery({ at: Date.now(), count: modelsList.models.length });
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(accountId) });
      await accountsQuery.refetch();
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscover = async () => {
    if (busy || saved === null || dirty) return;
    setBusy(true);
    setProbeError(null);
    try {
      const modelsList = await adhamClient.discoverOllamaModels(saved.accountId);
      setDiscovery({ at: Date.now(), count: modelsList.models.length });
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(saved.accountId) });
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
          disabled={busy || current.length === 0}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('settings.providers.testing') : t('settings.providers.testConnection')}
        </button>
        <button
          type="button"
          onClick={() => void handleDiscover()}
          disabled={busy || saved === null || dirty}
          title={
            dirty
              ? t('settings.providers.unsavedAttribution', { url: saved?.endpointUrl ?? current })
              : undefined
          }
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('settings.providers.discoverModels')}
        </button>
      </div>

      <div aria-live="polite" className="space-y-1 text-xs text-foreground-secondary">
        {saved === null ? (
          <p>{t('settings.providers.notConfiguredLine')}</p>
        ) : (
          <>
            <p>
              {t('settings.providers.configuredLine', {
                alias: saved.alias,
                url: saved.endpointUrl,
              })}
            </p>
            {modelsQuery.data && (
              <p>
                {models.length > 0
                  ? t('settings.providers.inventoryLine', {
                      count: models.length,
                      url: saved.endpointUrl,
                    })
                  : t('settings.providers.inventoryNone', { url: saved.endpointUrl })}
              </p>
            )}
            {dirty && models.length > 0 && (
              <p>{t('settings.providers.unsavedAttribution', { url: saved.endpointUrl })}</p>
            )}
          </>
        )}
        {checkCurrent ? (
          check.reachable ? (
            <p>
              {t('settings.providers.lastCheckReachable', {
                time: fmtTime(check.at),
                count: check.tags ?? 0,
              })}
            </p>
          ) : (
            <p role="alert">
              {t('settings.providers.unreachable', {
                time: fmtTime(check.at),
                url: check.endpoint,
              })}
            </p>
          )
        ) : saved !== null || check !== null ? (
          <p>{t('settings.providers.checkPending', { url: current })}</p>
        ) : null}
        {saved !== null && !dirty && discovery !== null && (
          <p>
            {t('settings.providers.lastDiscovery', {
              count: discovery.count,
              time: fmtTime(discovery.at),
            })}
          </p>
        )}
        {probeError !== null && (
          <p role="alert">
            {t('settings.providers.probeFailed', {
              url: saved?.endpointUrl ?? current,
              error: probeError,
            })}
          </p>
        )}
      </div>
    </section>
  );
}
