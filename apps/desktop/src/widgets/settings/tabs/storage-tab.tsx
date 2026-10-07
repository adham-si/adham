import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { adhamClient, type StorageStatus } from '@/shared/api/adham-client';

export function StorageTab() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<StorageStatus | null>(null);
  const [isRebuilding, setIsRebuilding] = React.useState(false);

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
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('settings.storage.title')}</h3>
        <p className="text-xs text-foreground-secondary">{t('settings.storage.desc')}</p>
      </div>

      {/* Database Status */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground-secondary">{t('settings.storage.journalMode')}</span>
          <span className="font-mono font-medium text-running">
            {status?.journalMode || 'WAL (Write-Ahead Logging)'}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs border-t border-border-subtle pt-2">
          <span className="text-foreground-secondary">{t('settings.storage.dbLocation')}</span>
          <span className="font-mono text-foreground">%LOCALAPPDATA%\Adham\data</span>
        </div>

        <div className="flex items-center justify-between text-xs border-t border-border-subtle pt-2">
          <span className="text-foreground-secondary">Schema Version</span>
          <span className="font-mono text-foreground">
            {status ? `v${status.schemaVersion}` : 'v1'}
          </span>
        </div>
      </div>

      {/* Maintenance Actions */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Maintenance & Recovery
        </div>
        <p className="text-xs text-foreground-secondary">
          Reconstruct in-memory or projection tables from canonical SQLite event logs.
        </p>
        <Button size="sm" variant="secondary" onClick={handleRebuild} disabled={isRebuilding}>
          {isRebuilding ? t('status.loading') : t('settings.storage.rebuildProjections')}
        </Button>
      </div>
    </div>
  );
}
