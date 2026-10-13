import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { adhamClient, type StorageStatus } from '@/shared/api/adham-client';

export function DataPage() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<StorageStatus | null>(null);
  const [isRebuilding, setIsRebuilding] = React.useState(false);
  const [autoVacuum, setAutoVacuum] = React.useState(true);

  React.useEffect(() => {
    adhamClient.getStorageStatus().then(setStatus).catch(console.error);
  }, []);

  const handleRebuild = async () => {
    setIsRebuilding(true);
    try {
      await adhamClient.getStorageStatus();
    } finally {
      setIsRebuilding(false);
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
        <div className="space-y-4">
          {/* Storage Directory */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.storage.dbLocation', 'Database Location')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5 font-mono">
                %LOCALAPPDATA%\Adham\data
              </div>
            </div>
            <span className="rounded bg-surface-muted px-2 py-1 text-xs text-foreground-muted font-medium">
              {t('settings.data.encryptedBadge', 'Encrypted Local')}
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
              {status?.journalMode || t('settings.data.walFallback', 'WAL (Write-Ahead)')}
            </span>
          </div>

          {/* Schema Version */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.data.schemaLabel', 'Schema version')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t('settings.data.schemaHint', 'Applied migration version of core database tables')}
              </div>
            </div>
            <span className="font-mono text-xs text-foreground">
              {status ? `v${status.schemaVersion}` : 'v1.0.0'}
            </span>
          </div>

          {/* Auto-vacuum */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.data.vacuumLabel', 'Automatic database vacuum')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.data.vacuumHint',
                  'Reclaim unused space when deleting old sessions or message cards',
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoVacuum}
              aria-label={t('settings.data.vacuumLabel', 'Automatic database vacuum')}
              onClick={() => setAutoVacuum(!autoVacuum)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                autoVacuum ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  autoVacuum ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Maintenance Actions Section */}
      <section aria-labelledby="maintenance-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="maintenance-heading" className="text-sm font-semibold text-foreground">
            {t('settings.data.maintenanceTitle', 'Maintenance & recovery')}
          </h3>
        </div>
        <div className="space-y-4">
          {/* Rebuild Projection */}
          <div className="flex items-center justify-between">
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
            </div>
            <Button size="sm" variant="secondary" onClick={handleRebuild} disabled={isRebuilding}>
              {isRebuilding
                ? t('settings.data.rebuilding', 'Rebuilding…')
                : t('settings.data.rebuildIndex', 'Rebuild Index')}
            </Button>
          </div>

          {/* Purge Scratch */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('settings.data.clearLabel', 'Clear scratch cache')}
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                {t(
                  'settings.data.clearHint',
                  'Remove temporary test artifacts and subagent run logs',
                )}
              </div>
            </div>
            <Button size="sm" variant="secondary">
              {t('settings.data.clearButton', 'Clear Cache')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
