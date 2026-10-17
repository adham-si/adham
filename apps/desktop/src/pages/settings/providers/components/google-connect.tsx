import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

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
 * Google Gemini card (Delivery G): fixed official endpoint (display only —
 * never an input), consent-gated write-only key input, then the SAME
 * endpoint-guarded state discipline as the Ollama card: a check/discovery is
 * only ever rendered under the account it ran against, results carry their
 * timestamps, and the configured state restores from the registry — never a
 * guessed status after reopen.
 */
export function GoogleConnect() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const saved = accountsQuery.data?.accounts.find((a) => a.kind === 'google_gemini') ?? null;
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(saved?.accountId ?? 'none'),
    queryFn: () => adhamClient.listProviderModels(saved!.accountId),
    enabled: saved !== null,
    staleTime: 60_000,
    retry: false,
  });

  const [consent, setConsent] = React.useState(false);
  const [keyDraft, setKeyDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [check, setCheck] = React.useState<CheckResult | null>(null);
  const [discovery, setDiscovery] = React.useState<DiscoveryResult | null>(null);
  const [rotatedAt, setRotatedAt] = React.useState<number | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = React.useState(false);

  const current = saved?.endpointUrl ?? '';
  const models = modelsQuery.data?.models ?? [];

  const handleConnect = async () => {
    if (busy || !consent) return;
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    setBusy(true);
    setError(null);
    try {
      await adhamClient.configureGoogleAccount({
        accountId: saved?.accountId ?? null,
        alias: saved?.alias ?? null,
        apiKey,
        acknowledgeCloudTransfer: true,
      });
      // write-only: the key never outlives the submit (and unmount discards
      // the draft completely — there is no stored draft anywhere)
      setKeyDraft('');
      setRotatedAt(Date.now());
      setDiscovery(null);
      await accountsQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (busy || saved === null) return;
    setBusy(true);
    setProbeError(null);
    try {
      const health = await adhamClient.testProviderConnection(saved.accountId);
      setCheck({
        endpoint: current,
        at: Date.now(),
        reachable: health.reachable,
        tags: health.modelTagCount,
      });
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscover = async () => {
    if (busy || saved === null) return;
    setBusy(true);
    setProbeError(null);
    try {
      const modelsList = await adhamClient.discoverOllamaModels(saved.accountId);
      setDiscovery({ at: Date.now(), count: modelsList.models.length });
      queryClient.invalidateQueries({
        queryKey: queryKeys.providerModels(saved.accountId),
      });
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (busy || saved === null) return;
    setBusy(true);
    setError(null);
    try {
      await adhamClient.disconnectGoogleAccount(saved.accountId);
      setConfirmingDisconnect(false);
      setCheck(null);
      setDiscovery(null);
      setRotatedAt(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerAccounts });
      await accountsQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const checkCurrent = check !== null && check.endpoint === current;

  return (
    <section aria-labelledby="google-connect-heading" className="space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <h3 id="google-connect-heading" className="text-sm font-semibold text-foreground">
          {t('settings.providers.googleSectionTitle')}
        </h3>
        <span className="text-xs text-foreground-secondary">
          {t('settings.providers.cloudBadge')}
        </span>
      </div>

      <label className="flex items-start gap-2 text-xs text-foreground-secondary">
        <input
          type="checkbox"
          aria-label={t('settings.providers.googleConsentLabel')}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>{t('settings.providers.googleConsentLabel')}</span>
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="password"
          aria-label={t('settings.providers.googleKeyLabel')}
          placeholder={t('settings.providers.googleKeyPlaceholder')}
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={busy || !consent || keyDraft.trim().length === 0}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('settings.providers.googleConnect')}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={busy || saved === null}
          aria-label={t('settings.providers.googleTestLabel')}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('settings.providers.testConnection')}
        </button>
        <button
          type="button"
          onClick={() => void handleDiscover()}
          disabled={busy || saved === null}
          aria-label={t('settings.providers.googleDiscoverLabel')}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('settings.providers.discoverModels')}
        </button>
      </div>

      {saved === null && (
        <div aria-live="polite" className="space-y-1 text-xs text-foreground-secondary">
          <p>{t('settings.providers.googleDisconnectedLine')}</p>
          {!consent && <p>{t('settings.providers.googleConsentRequired')}</p>}
        </div>
      )}

      {saved !== null && (
        <div aria-live="polite" className="space-y-1 text-xs text-foreground-secondary">
          <p>
            {t('settings.providers.googleConfiguredLine', {
              alias: saved.alias,
              url: saved.endpointUrl,
            })}
          </p>
          <p>{t('settings.providers.googleKeySealedNote')}</p>
          {modelsQuery.data && (
            <p>
              {models.length > 0
                ? t('settings.providers.inventoryLine', { count: models.length, url: current })
                : t('settings.providers.inventoryNone', { url: current })}
            </p>
          )}
          {rotatedAt !== null && (
            <p>{t('settings.providers.googleRotated', { time: fmtTime(rotatedAt) })}</p>
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
                {t('settings.providers.googleUnreachable', {
                  time: fmtTime(check.at),
                  url: check.endpoint,
                })}
              </p>
            )
          ) : null}
          {discovery !== null && (
            <p>
              {t('settings.providers.lastDiscovery', {
                count: discovery.count,
                time: fmtTime(discovery.at),
              })}
            </p>
          )}
          <div className="pt-1">
            {confirmingDisconnect ? (
              <div className="flex items-center gap-2">
                <span>{t('settings.providers.googleConfirmDisconnect')}</span>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={busy}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium"
                >
                  {t('settings.providers.googleDisconnectConfirmLabel')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(false)}
                  className="rounded-md px-2 py-1 text-xs text-foreground-secondary"
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={busy}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground-secondary"
              >
                {t('settings.providers.googleDisconnect')}
              </button>
            )}
          </div>
        </div>
      )}
      {probeError !== null && (
        <p role="alert">
          {t('settings.providers.probeFailed', {
            url: current,
            error: probeError,
          })}
        </p>
      )}
      {error !== null && <p role="alert">{t('settings.providers.googleFailedLine', { error })}</p>}
    </section>
  );
}
