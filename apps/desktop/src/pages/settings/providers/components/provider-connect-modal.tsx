import type { ProviderAccountDto } from '@adham/contracts-generated';
import {
  Button,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@adham/ui';
import { Cancel01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { type ProviderCatalogEntry, type ProviderStatus, StatusBadge } from './provider-card';

interface CheckResult {
  endpoint: string;
  at: number;
  reachable: boolean;
  tags: number | null;
}

const inputClass = 'w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm';

export interface ProviderConnectModalProps {
  entry: ProviderCatalogEntry;
  status: ProviderStatus;
  open: boolean;
  onClose: () => void;
  saved: ProviderAccountDto | null;
  /** Auto status probe result from the page (seeded as the last check). */
  initialCheck: CheckResult | null;
  onProbeOutcome: (reachable: boolean) => void;
  refreshAccounts: () => Promise<void>;
}

/**
 * Connect/manage dialog for one provider. The user sees three things only:
 * status (Connected/Offline with the model count and a Sync affordance), the
 * credential/endpoint control, and two footer actions. Delivery A/G rules stay
 * intact: a failed transient test persists nothing, the Google key draft is
 * write-only, a check only shows while it matches the current endpoint, and
 * disconnect confirms because it cascades the credential and models.
 */
export function ProviderConnectModal({
  entry,
  status,
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
      <DialogContent data-connect-dialog="" className="space-y-4">
        <DialogClose
          aria-label={t('common.close')}
          className="absolute top-3 end-3 flex size-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-icon-sm" />
        </DialogClose>
        <div className="flex items-center gap-3 pe-10">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-raised p-2">
            <img src={entry.logo} alt="" className="size-6 object-contain" />
          </div>
          <DialogTitle className="mb-0">{entry.name}</DialogTitle>
          <StatusBadge status={status} />
        </div>
        <DialogDescription className="mb-2">{t(entry.descKey)}</DialogDescription>
        {entry.id === 'google' ? (
          <GoogleFlow
            saved={saved}
            initialCheck={initialCheck}
            onProbeOutcome={onProbeOutcome}
            refreshAccounts={refreshAccounts}
            onClose={onClose}
          />
        ) : (
          <OllamaFlow
            saved={saved}
            initialCheck={initialCheck}
            onProbeOutcome={onProbeOutcome}
            refreshAccounts={refreshAccounts}
          />
        )}
      </DialogContent>
    </DialogRoot>
  );
}

interface FlowProps {
  saved: ProviderAccountDto | null;
  initialCheck: CheckResult | null;
  onProbeOutcome: (reachable: boolean) => void;
  refreshAccounts?: () => Promise<void>;
  onClose?: () => void;
}

/** One clean status row: colored dot + verdict text, optional Sync affordance. */
function StatusLine({
  ok,
  children,
  trailing,
}: {
  ok: boolean | null;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${
          ok === null
            ? 'bg-foreground-muted'
            : ok
              ? 'bg-success-foreground'
              : 'bg-danger-foreground'
        }`}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </div>
  );
}

function SyncButton({
  onSync,
  disabled,
  title,
}: {
  onSync: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onSync}
      disabled={disabled}
      title={title}
      aria-label={t('settings.providers.sync')}
      className="shrink-0"
    >
      <HugeiconsIcon icon={RefreshIcon} className="size-icon-sm" />
      {t('settings.providers.sync')}
    </Button>
  );
}

function GoogleFlow({ saved, initialCheck, onProbeOutcome, refreshAccounts, onClose }: FlowProps) {
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
  const [rotating, setRotating] = React.useState(false);
  const [check, setCheck] = React.useState<CheckResult | null>(initialCheck);
  const [probeError, setProbeError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = React.useState(false);

  const models = modelsQuery.data?.models ?? [];

  /** After connect or a key change: verify once, then load models — no manual steps. */
  const autoVerify = async (accountId: string, endpointUrl: string) => {
    const health = await adhamClient.testProviderConnection(accountId);
    setCheck({ endpoint: endpointUrl, at: Date.now(), reachable: health.reachable, tags: null });
    onProbeOutcome(health.reachable);
    if (health.reachable) {
      await adhamClient.discoverOllamaModels(accountId);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(accountId) });
    }
  };

  const submitKey = async () => {
    if (busy || !consent) return;
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    setBusy(true);
    setError(null);
    try {
      const account = await adhamClient.configureGoogleAccount({
        accountId: saved?.accountId ?? null,
        alias: saved?.alias ?? null,
        apiKey,
        acknowledgeCloudTransfer: true,
      });
      // write-only: the key never outlives the submit (unmount discards the draft)
      setKeyDraft('');
      setConsent(false);
      setRotating(false);
      await refreshAccounts?.();
      await autoVerify(account.accountId, account.endpointUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (busy || saved === null) return;
    setBusy(true);
    setProbeError(null);
    try {
      await adhamClient.discoverOllamaModels(saved.accountId);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(saved.accountId) });
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
      await refreshAccounts?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // A probe is meaningful only while it ran against this account's endpoint.
  const currentCheck =
    saved !== null && check !== null && check.endpoint === saved.endpointUrl ? check : null;

  return (
    <div className="space-y-3">
      {saved !== null && (
        <div className="space-y-1">
          {currentCheck !== null && (
            <StatusLine
              ok={currentCheck.reachable}
              trailing={
                currentCheck.reachable ? (
                  <SyncButton onSync={() => void handleSync()} disabled={busy} />
                ) : undefined
              }
            >
              {currentCheck.reachable ? (
                <span className="text-foreground">
                  {t('settings.providers.statusAvailable', { count: models.length })}
                </span>
              ) : (
                <span className="text-foreground">
                  {t('settings.providers.googleUnreachable', { url: saved.endpointUrl })}
                </span>
              )}
            </StatusLine>
          )}
          {probeError !== null && (
            <p role="alert" className="text-xs text-danger-foreground">
              {t('settings.providers.probeFailed', { error: probeError })}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-xs text-danger-foreground">
              {t('settings.providers.googleFailedLine', { error })}
            </p>
          )}
        </div>
      )}

      {saved === null || rotating ? (
        <div className="space-y-2.5 rounded-lg border border-border-subtle p-3">
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
          <input
            type="password"
            aria-label={t('settings.providers.googleKeyLabel')}
            placeholder={t('settings.providers.googleKeyPlaceholder')}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
          <span>🔒 {t('settings.providers.googleKeyNote')}</span>
          <Button size="sm" variant="secondary" onClick={() => setRotating(true)} disabled={busy}>
            {t('settings.providers.updateKey')}
          </Button>
        </div>
      )}

      {saved !== null && confirmingDisconnect && (
        <p className="text-xs text-foreground-secondary">
          {t('settings.providers.googleConfirmDisconnect')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {saved !== null && confirmingDisconnect ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmingDisconnect(false)}
              disabled={busy}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleDisconnect()} disabled={busy}>
              {t('settings.providers.googleDisconnectConfirmLabel')}
            </Button>
          </>
        ) : saved === null || rotating ? (
          rotating ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setRotating(false);
                  setKeyDraft('');
                }}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void submitKey()}
                disabled={busy || !consent || keyDraft.trim().length === 0}
              >
                {t('settings.providers.updateKey')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => void submitKey()}
              disabled={busy || !consent || keyDraft.trim().length === 0}
              className="col-span-2"
            >
              {t('settings.providers.googleConnect')}
            </Button>
          )
        ) : (
          <>
            <Button variant="danger" onClick={() => setConfirmingDisconnect(true)} disabled={busy}>
              {t('settings.providers.googleDisconnect')}
            </Button>
            <Button variant="primary" onClick={onClose} disabled={busy}>
              {t('settings.providers.done')}
            </Button>
          </>
        )}
      </div>
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
  const [probeError, setProbeError] = React.useState<string | null>(null);

  const value = editedEndpoint ?? saved?.endpointUrl ?? '';
  const current = value.trim();
  const dirty = saved !== null && editedEndpoint !== null && editedEndpoint !== saved.endpointUrl;
  const models = modelsQuery.data?.models ?? [];

  /** One action: probe (transiently for unsaved/edited hosts), save only on
   * reachability, then load the models — the old Test/Discover pair, merged. */
  const saveAndReconnect = async () => {
    if (busy || !current) return;
    setBusy(true);
    setProbeError(null);
    try {
      // Unsaved/changed endpoints probe transiently, so a failed test saves
      // nothing: the empty accountId makes the backend skip persistence.
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
      await adhamClient.discoverOllamaModels(accountId);
      setCheck({ endpoint: current, at: Date.now(), reachable: true, tags: health.modelTagCount });
      onProbeOutcome(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(accountId) });
      // the minted/updated identity must reach the page's account state
      if (!saved || dirty) await refreshAccounts?.();
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (busy || saved === null) return;
    setBusy(true);
    setProbeError(null);
    try {
      await adhamClient.discoverOllamaModels(saved.accountId);
      queryClient.invalidateQueries({ queryKey: queryKeys.providerModels(saved.accountId) });
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // A probe is meaningful only while it ran against the endpoint in the input.
  const currentCheck = check !== null && check.endpoint === current ? check : null;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="ollama-host"
          className="block text-xs font-medium text-foreground-secondary"
        >
          {t('settings.providers.endpointHostLabel')}
        </label>
        <input
          id="ollama-host"
          type="text"
          aria-label={t('settings.providers.endpointHostLabel')}
          placeholder={t('settings.providers.endpointPlaceholder')}
          value={value}
          onChange={(e) => setEditedEndpoint(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        {currentCheck !== null && (
          <StatusLine
            ok={currentCheck.reachable}
            trailing={
              currentCheck.reachable ? (
                <SyncButton
                  onSync={() => void handleSync()}
                  disabled={busy || dirty}
                  {...(dirty
                    ? {
                        title: t('settings.providers.syncDirty', {
                          url: saved?.endpointUrl ?? current,
                        }),
                      }
                    : {})}
                />
              ) : undefined
            }
          >
            {currentCheck.reachable ? (
              <span className="text-foreground">
                {t('settings.providers.statusAvailable', { count: models.length })}
              </span>
            ) : (
              <span className="text-foreground">
                {t('settings.providers.offlineMessage', { url: currentCheck.endpoint })}
              </span>
            )}
          </StatusLine>
        )}
        {probeError !== null && (
          <p role="alert" className="text-xs text-danger-foreground">
            {t('settings.providers.probeFailed', { error: probeError })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          onClick={() => void saveAndReconnect()}
          disabled={busy || current.length === 0}
          className="col-span-2"
        >
          {busy ? t('settings.providers.testing') : t('settings.providers.saveReconnect')}
        </Button>
      </div>
    </div>
  );
}
