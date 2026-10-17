import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * Registry-pinned models for EVERY connected provider account (Delivery G
 * generalization of the Ollama-only list). Sections come from
 * providerAccounts × providerModels — no account-name, prefix or kind
 * conditions. Listing is order-of-discovery; the composer requires an
 * explicit user selection and promotes none automatically.
 */
export function ProviderModelSections() {
  const { t } = useTranslation();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-6">
      {accounts.map((account) => (
        <ProviderModelSection
          key={account.accountId}
          accountId={account.accountId}
          alias={account.alias}
        />
      ))}
      {accounts.length === 0 && (
        <p className="text-xs text-foreground-secondary">{t('settings.models.noneConnected')}</p>
      )}
    </div>
  );
}

function ProviderModelSection({ accountId, alias }: { accountId: string; alias: string }) {
  const { t } = useTranslation();
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(accountId),
    queryFn: () => adhamClient.listProviderModels(accountId),
    staleTime: 60_000,
    retry: false,
  });
  const models = modelsQuery.data?.models ?? [];
  if (models.length === 0) return null;

  // Only recorded `supported` capabilities render; the registry's `unknown`
  // values stay unknown — nothing is inferred from the model's name.
  const capabilityLabels = [
    ['streaming', t('settings.models.capStreaming')],
    ['thinking', t('settings.models.capThinking')],
    ['toolProposals', t('settings.models.capToolProposals')],
    ['structuredOutput', t('settings.models.capStructuredOutput')],
  ] as const;

  return (
    <section aria-labelledby={`provider-models-heading-${accountId}`} className="space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <h3
          id={`provider-models-heading-${accountId}`}
          className="text-sm font-semibold text-foreground"
        >
          {alias}
        </h3>
        <span className="text-xs text-foreground-secondary">
          {t('settings.providers.discoveredCount', { count: models.length })}
        </span>
      </div>
      <ul className="space-y-2">
        {models.map((m) => {
          const caps = capabilityLabels.filter(([key]) => m.capabilities[key] === 'supported');
          return (
            <li
              key={m.modelId}
              className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{m.humanLabel}</p>
                {m.modelId !== m.humanLabel && (
                  <p className="truncate text-xs text-foreground-secondary">{m.modelId}</p>
                )}
                <p className="truncate text-[11px] text-foreground-muted">
                  {alias}
                  {m.digest.length > 0 && (
                    <>
                      {' · '}
                      {`sha256:${m.digest.slice(0, 12)}…`}
                    </>
                  )}
                </p>
              </div>
              {caps.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1 pl-2">
                  {caps.map(([key, label]) => (
                    <span
                      key={key}
                      className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-foreground-secondary"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
