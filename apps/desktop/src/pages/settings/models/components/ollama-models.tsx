import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * Pinned Ollama models for the connected local account (registry read —
 * no network). Listing is order-of-discovery; the composer requires an
 * explicit user selection and promotes none automatically.
 */
export function OllamaModels() {
  const { t } = useTranslation();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const saved = accountsQuery.data?.accounts.find((a) => a.privacyClass === 'local_only') ?? null;
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(saved?.accountId ?? 'none'),
    queryFn: () => adhamClient.listProviderModels(saved!.accountId),
    enabled: saved !== null,
    staleTime: 60_000,
    retry: false,
  });
  const models = modelsQuery.data?.models ?? [];
  if (saved === null || models.length === 0) return null;

  return (
    <section aria-labelledby="ollama-models-heading" className="space-y-3">
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <h3 id="ollama-models-heading" className="text-sm font-semibold text-foreground">
          {t('settings.models.ollamaTitle')}
        </h3>
        <span className="text-xs text-foreground-secondary">
          {t('settings.providers.discoveredCount', { count: models.length })}
        </span>
      </div>
      <ul className="space-y-2">
        {models.map((m) => (
          <li
            key={m.modelId}
            className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{m.humanLabel}</p>
              <p className="truncate text-xs text-foreground-secondary">{m.modelId}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
