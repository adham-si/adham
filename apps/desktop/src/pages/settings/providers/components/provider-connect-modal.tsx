import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@adham/ui';
import type { ProviderAccountDto } from '@adham/contracts-generated';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import type { ProviderCatalogEntry } from './provider-card';

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

export interface ProviderConnectModalProps {
  entry: ProviderCatalogEntry;
  open: boolean;
  onClose: () => void;
  saved: ProviderAccountDto | null;
  /** Auto status probe result for this provider from the page (seeded as the last check). */
  initialCheck: CheckResult | null;
  /** Syncs the card status badge after a modal-run probe. */
  onProbeOutcome: (reachable: boolean) => void;
  refreshAccounts: () => Promise<void>;
}

/**
 * Connect/manage dialog for one provider (page card opens it in front of the
 * settings surface). Both flows keep their Delivery A/G discipline: a
 * check/discovery renders only under the account it ran against, results carry
 * timestamps, the Google key is write-only (the draft never outlives submit),
 * and Google disconnect stays a two-step confirmation (it cascades the
 * credential and discovered models).
 */
export function ProviderConnectModal({
  entry,
  open,
  onClose,
  saved,
  initialCheck,
  onProbeOutcome,
  refreshAccounts,
}: ProviderConnectModalProps) {
  const { t } = useTranslation();

  return (
    <DialogRoot open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        // Settings closes on any Escape; this dialog must own it while open.
        data-connect-dialog=""
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-raised p-2">
            <img src={entry.logo} alt="" className="size-6 object-contain" />
          </div>
          <DialogTitle className="mb-0">{entry.name}</DialogTitle>
        </div>
        <DialogDescription>{t(entry.descKey)}</DialogDescription>
        {saved !== null && (
          <p className="text-xs text-foreground-secondary">
            {t('settings.providers.configuredLine', {
              alias: saved.alias,
              url: saved.endpointUrl,
            })}
          </p>
        )}
        {entry.id === 'google' ? (
          <GoogleFlow
            saved={saved}
            initialCheck={initialCheck}
            onProbeOutcome={onProbeOutcome}
            refreshAccounts={refreshAccounts}
          />
        ) : (
          <OllamaFlow
            saved={saved}
            initialCheck={initialCheck}
            onProbeOutcome={onProbeOutcome}
            refreshAccounts={refreshAccounts}
          />
        )}
        <div className="flex justify-end border-t border-border-subtle pt-3">
          <DialogClose>{t('common.close')}</DialogClose>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

type FlowProps = Pick<
  ProviderConnectModalProps,
  'saved' | 'initialCheck' | 'onProbeOutcome' | 'refreshAccounts'
>;

const inputClass = 'w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm';

function GoogleFlow({ saved, initialCheck, onProbeOutcome, refreshAccounts }: FlowProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
  const [check, setCheck] = React.useState<CheckResult | null>(initialCheck);
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
      // write-only: the key never outlives the submit (unmount discards the
      // draft — no stored draft anywhere)
      setKeyDraft('');
      setRotatedAt(Date.now());
      setDiscovery(null);
      await refreshAccounts();
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
      onProbeOutcome(health.reachable);
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
      await refreshAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const checkCurrent = check !== null && check.endpoint === current;

  return (
    <div className="space-y-3">
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
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <Button
          variant="primary"
          onClick={() => void handleConnect()}
          disabled={busy || !consent || keyDraft.trim().length === 0}
        >
          {t('settings.providers.googleConnect')}
        </Button>
        <Button
          onClick={() => void handleTest()}
          disabled={busy || saved === null}
          aria-label={t('settings.providers.googleTestLabel')}
        >
          {t('settings.providers.testConnection')}
        </Button>
        <Button
          onClick={() => void handleDiscover()}
          disabled={busy || saved === null}
          aria-label={t('settings.providers.googleDiscoverLabel')}
        >
          {t('settings.providers.discoverModels')}
        </Button>
      </div>

      <div aria-live="polite" className="space-y-1 text-xs text-foreground-secondary">
        {saved === null && (
          <>
            <p>{t('settings.providers.googleDisconnectedLine')}</p>
            {!consent && <p>{t('settings.providers.googleConsentRequired')}</p>}
          </>
        )}
        {saved !== null && (
          <>
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
          </>
        )}
      </div>

      {saved !== null && (
        <div>
          {confirmingDisconnect ? (
            <div className="flex items-center gap-2 text-xs text-foreground-secondary">
              <span>{t('settings.providers.googleConfirmDisconnect')}</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void handleDisconnect()}
                disabled={busy}
              >
                {t('settings.providers.googleDisconnectConfirmLabel')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmingDisconnect(true)}
              disabled={busy}
            >
              {t('settings.providers.googleDisconnect')}
            </Button>
          )}
        </div>
      )}
      {probeError !== null && (
        <p role="alert" className="text-xs text-danger-foreground">
          {t('settings.providers.probeFailed', { url: current, error: probeError })}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger-foreground">
          {t('settings.providers.googleFailedLine', { error })}
        </p>
      )}
    </div>
  );
}

function OllamaFlow({ saved, initialCheck, onProbeOutcome, refreshAccounts }: FlowProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
  const [check, setCheck] = React.useState<CheckResult | null>(initialCheck);
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
        onProbeOutcome(false);
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
      onProbeOutcome(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(accountId) });
      // the minted/updated identity must reach the page's account state
      await refreshAccounts();
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
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          aria-label={t('settings.providers.endpointLabel')}
          placeholder={t('settings.providers.endpointPlaceholder')}
          value={value}
          onChange={(e) => setEditedEndpoint(e.target.value)}
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <Button onClick={() => void handleTest()} disabled={busy || current.length === 0}>
          {busy ? t('settings.providers.testing') : t('settings.providers.testConnection')}
        </Button>
        <Button
          onClick={() => void handleDiscover()}
          disabled={busy || saved === null || dirty}
          title={
            dirty
              ? t('settings.providers.unsavedAttribution', { url: saved?.endpointUrl ?? current })
              : undefined
          }
        >
          {t('settings.providers.discoverModels')}
        </Button>
      </div>

      <div aria-live="polite" className="space-y-1 text-xs text-foreground-secondary">
        {saved === null ? (
          <p>{t('settings.providers.notConfiguredLine')}</p>
        ) : (
          <>
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
          <p role="alert" className="text-xs text-danger-foreground">
            {t('settings.providers.probeFailed', {
              url: saved?.endpointUrl ?? current,
              error: probeError,
            })}
          </p>
        )}
      </div>
    </div>
  );
}
