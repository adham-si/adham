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

      {/* Storage Information Section (Image 1 style) */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Storage details</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Storage Directory */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Database location</div>
              <div className="text-xs text-foreground-secondary mt-0.5 font-mono">
                %LOCALAPPDATA%\Adham\data
              </div>
            </div>
            <span className="rounded bg-surface-muted px-2 py-1 text-xs text-foreground-muted font-medium">
              Encrypted Local
            </span>
          </div>

          {/* Journal Mode */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">SQLite journal mode</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Current transaction concurrency and recovery protocol
              </div>
            </div>
            <span className="rounded bg-success-surface px-2 py-0.5 text-xs text-success-foreground font-medium">
              {status?.journalMode || 'WAL (Write-Ahead)'}
            </span>
          </div>

          {/* Schema Version */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Schema version</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Applied migration version of core database tables
              </div>
            </div>
            <span className="font-mono text-xs text-foreground">
              {status ? `v${status.schemaVersion}` : 'v1.0.0'}
            </span>
          </div>

          {/* Auto-vacuum */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Automatic database vacuum</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Reclaim unused space when deleting old sessions or message cards
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoVacuum}
              aria-label="Automatic database vacuum"
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
      </div>

      {/* Maintenance Actions Section */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground pt-2 pb-1">Maintenance & recovery</h3>
        <div className="divide-y divide-border-subtle/40">
          {/* Rebuild Projection */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Rebuild projections</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Reconstruct in-memory search and message indices from event logs
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={handleRebuild} disabled={isRebuilding}>
              {isRebuilding ? 'Rebuilding…' : 'Rebuild Index'}
            </Button>
          </div>

          {/* Purge Scratch */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-foreground">Clear scratch cache</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Remove temporary test artifacts and subagent run logs
              </div>
            </div>
            <Button size="sm" variant="secondary">
              Clear Cache
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
