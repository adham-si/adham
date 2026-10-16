import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';

export function DataPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const storageQuery = useQuery({
    queryKey: queryKeys.storageStatus,
    queryFn: () => adhamClient.getStorageStatus(),
    staleTime: 30_000,
    // Fail fast to the unavailable state: the page offers an explicit Retry.
    retry: false,
  });
  const [confirming, setConfirming] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [rebuiltCount, setRebuiltCount] = React.useState<number | null>(null);
  const [rebuildFailed, setRebuildFailed] = React.useState(false);

  // Duplicate-click protection: the in-flight flag is checked synchronously
  // before any await, so a second click while pending dispatches nothing.
  const handleRebuild = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    setRebuildFailed(false);
    try {
      const res = await adhamClient.adminRebuildProjections();
      setRebuiltCount(res.replayedCount);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageStatus });
    } catch {
      setRebuildFailed(true);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.storage.title', { defaultValue: 'Data & Storage' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.storage.desc', {
            defaultValue: 'Manage local SQLite state, journal mode, and maintenance routines.',
          })}
        </p>
      </div>

      {/* Storage Information Section */}
      <section aria-labelledby="storage-details-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="storage-details-heading" className="text-sm font-semibold text-foreground">
            {t('settings.data.detailsTitle', 'Storage details')}
          </h3>
        </div>
        {storageQuery.isPending && (
          <p role="status" className="text-xs text-foreground-secondary">
            {t('settings.data.loadingStorage', 'Loading storage details…')}
          </p>
        )}
        {storageQuery.isError && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-foreground-secondary">
              {t(
                'settings.data.unavailableHint',
                'Storage details are unavailable. Check that the local database is reachable, then retry.',
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void storageQuery.refetch()}
              disabled={storageQuery.isFetching}
            >
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {storageQuery.data && (
          <div className="space-y-4">
            {/* Storage Directory (resolved by the backend platform policy) */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {t('settings.storage.dbLocation', 'Database Location')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5 font-mono break-all">
                  {storageQuery.data.dataDir}
                </div>
              </div>
              <span className="rounded bg-surface-muted px-2 py-1 text-xs text-foreground-muted font-medium shrink-0">
                {storageQuery.data.status}
              </span>
            </div>

            {/* Journal Mode */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.storage.journalMode', 'Journal Mode')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.data.journalHint',
                    'Current transaction concurrency and recovery protocol',
                  )}
                </div>
              </div>
              <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
                {storageQuery.data.journalMode}
              </span>
            </div>

            {/* Schema Version */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.data.schemaLabel', 'Schema version')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.data.schemaHint',
                    'Applied migration version of core database tables',
                  )}
                </div>
              </div>
              <span className="font-mono text-xs text-foreground">
                v{storageQuery.data.schemaVersion}
              </span>
            </div>

            {/* Content protection (accurate description, not a badge claim) */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.data.protectionTitle', 'Content protection')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.data.protectionHint',
                    'Message content is sealed with XChaCha20-Poly1305 using a key held in your OS credential store. The database file itself is not separately encrypted.',
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Maintenance Actions Section */}
      <section aria-labelledby="maintenance-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="maintenance-heading" className="text-sm font-semibold text-foreground">
            {t('settings.data.maintenanceTitle', 'Maintenance & recovery')}
          </h3>
        </div>
        <div className="space-y-4">
          {/* Rebuild Projection (real backend operation, confirmed) */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.storage.rebuildProjections', 'Rebuild Projections')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.data.rebuildHint',
                  'Reconstruct in-memory search and message indices from event logs',
                )}
              </div>
              {rebuiltCount !== null && !rebuildFailed && (
                <div role="status" className="text-xs text-success font-medium mt-1">
                  {t('settings.data.rebuiltResult', 'Rebuilt {{count}} messages.', {
                    count: rebuiltCount,
                  })}
                </div>
              )}
              {rebuildFailed && (
                <div role="alert" className="text-xs text-destructive font-medium mt-1">
                  {t(
                    'settings.data.rebuildFailed',
                    'Rebuild failed. Your data is unchanged — try again.',
                  )}
                </div>
              )}
            </div>
            {confirming ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                  disabled={rebuilding}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleRebuild()}
                  disabled={rebuilding}
                >
                  {rebuilding
                    ? t('settings.data.rebuilding', 'Rebuilding…')
                    : t('settings.data.rebuildConfirm', 'Confirm rebuild')}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRebuiltCount(null);
                  setRebuildFailed(false);
                  setConfirming(true);
                }}
                disabled={!storageQuery.data}
              >
                {t('settings.data.rebuildIndex', 'Rebuild Index')}
              </Button>
            )}
          </div>

          {/*
            Auto-vacuum and Clear-cache controls are intentionally gone: no
            backend operation backs them, so they were placebos. They return
            with their own contracts if maintenance ever needs them.
          */}
        </div>
      </section>
    </div>
  );
}
