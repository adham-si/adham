import type { ProviderAccountDto } from '@adham/contracts-generated';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { notifyProvidersChanged } from '@/shared/providers/provider-events';
import {
  ProviderCard,
  type ProviderCatalogEntry,
  ProviderConnectModal,
  type ProviderId,
  type ProviderStatus,
} from './components';

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: 'google',
    name: 'Google Gemini',
    logo: '/media/provider/gemini.svg',
    descKey: 'settings.providers.descGoogle',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    logo: '/media/provider/ollama.svg',
    descKey: 'settings.providers.descOllama',
  },
];

/**
 * Providers page: a Notion-style card per supported provider. Card status is
 * connectivity truth: on open (and whenever an account id changes) every
 * connected provider is re-probed once with a metadata-only check, so a dead
 * endpoint (e.g. Ollama not running) shows as an issue instead of a stale
 * "Connected". A registry read alone never claims reachability.
 */
export function ProvidersPage() {
  const { t } = useTranslation();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const googleSaved = accounts.find((a) => a.kind === 'google_gemini') ?? null;
  const ollamaSaved = accounts.find((a) => a.privacyClass === 'local_only') ?? null;
  const savedById: { google?: ProviderAccountDto; ollama?: ProviderAccountDto } = {};
  if (googleSaved !== null) savedById.google = googleSaved;
  if (ollamaSaved !== null) savedById.ollama = ollamaSaved;

  // Auto status probe: 'connected' | 'issue' outcome per provider, null = not
  // settled yet (badge shows the in-between "Checking…" state).
  const [outcome, setOutcome] = React.useState<Partial<Record<ProviderId, 'connected' | 'issue'>>>(
    {},
  );
  const [probeResult, setProbeResult] = React.useState<
    Partial<
      Record<
        ProviderId,
        { endpoint: string; at: number; reachable: boolean; tags: number | null } | null
      >
    >
  >({});
  const [openKind, setOpenKind] = React.useState<ProviderId | null>(null);

  React.useEffect(() => {
    const targets: Array<{ id: ProviderId; account: ProviderAccountDto }> = [];
    if (googleSaved !== null) targets.push({ id: 'google', account: googleSaved });
    if (ollamaSaved !== null) targets.push({ id: 'ollama', account: ollamaSaved });
    if (targets.length === 0) {
      setOutcome({});
      setProbeResult({});
      return;
    }
    let cancelled = false;
    setOutcome({});
    setProbeResult({});
    void Promise.all(
      targets.map(async ({ id, account }) => {
        try {
          const health = await adhamClient.testProviderConnection(account.accountId);
          if (cancelled) return;
          setOutcome((prev) => ({ ...prev, [id]: health.reachable ? 'connected' : 'issue' }));
          setProbeResult((prev) => ({
            ...prev,
            [id]: {
              endpoint: account.endpointUrl,
              at: Date.now(),
              reachable: health.reachable,
              tags: health.modelTagCount,
            },
          }));
        } catch {
          if (cancelled) return;
          setOutcome((prev) => ({ ...prev, [id]: 'issue' }));
          setProbeResult((prev) => ({ ...prev, [id]: null }));
        }
      }),
    ).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Re-probe on page open and whenever a provider's account identity changes
    // (connect/disconnect/re-issue) — never on unrelated renders.
  }, [googleSaved?.accountId, ollamaSaved?.accountId, accountsQuery.data]);

  const statusFor = (id: ProviderId): ProviderStatus => {
    if (savedById[id] === undefined) return 'not-connected';
    const settled = outcome[id];
    if (settled === 'connected') return 'connected';
    if (settled === 'issue') return 'issue';
    return 'checking';
  };

  const refreshAccounts = React.useCallback(
    () =>
      accountsQuery.refetch().then(() => {
        notifyProvidersChanged();
      }),
    [accountsQuery],
  );

  const openEntry = PROVIDER_CATALOG.find((e) => e.id === openKind) ?? null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.providers.title', 'AI Providers')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">{t('settings.providers.desc')}</p>
      </div>

      {/* Provider catalog: Google Gemini (Delivery G) + Ollama (Delivery A).
          Opening the connect dialog is the only path to the flows below. */}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {PROVIDER_CATALOG.map((entry) => (
          <ProviderCard
            key={entry.id}
            provider={entry}
            status={statusFor(entry.id)}
            onOpen={() => setOpenKind(entry.id)}
          />
        ))}
      </div>

      {openEntry !== null && (
        <ProviderConnectModal
          entry={openEntry}
          status={statusFor(openEntry.id)}
          open
          onClose={() => setOpenKind(null)}
          saved={savedById[openEntry.id] ?? null}
          initialCheck={probeResult[openEntry.id] ?? null}
          onProbeOutcome={(reachable) =>
            setOutcome((prev) => ({ ...prev, [openEntry.id]: reachable ? 'connected' : 'issue' }))
          }
          refreshAccounts={refreshAccounts}
        />
      )}
    </div>
  );
}
