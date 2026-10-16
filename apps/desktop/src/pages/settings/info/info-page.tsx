import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { usePlatform } from '@/shared/platform';
import { buildDiagnosticsReport } from '@/shared/diagnostics/diagnostics-report';

export function InfoPage() {
  const { t } = useTranslation();
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const currentPlatform = usePlatform();

  const platformQuery = useQuery({
    queryKey: queryKeys.platformInfo,
    queryFn: () => adhamClient.getPlatformInfo(),
    staleTime: Infinity,
    retry: false,
  });
  const storageQuery = useQuery({
    queryKey: queryKeys.storageStatus,
    queryFn: () => adhamClient.getStorageStatus(),
    staleTime: 30_000,
    retry: false,
  });

  const osLabel =
    platformQuery.data?.os === 'macos'
      ? 'macOS (Darwin)'
      : platformQuery.data?.os === 'windows'
        ? 'Windows'
        : platformQuery.data?.os === 'linux'
          ? 'Linux'
          : currentPlatform.isMac
            ? 'macOS (Darwin)'
            : currentPlatform.isWindows
              ? 'Windows'
              : currentPlatform.isLinux
                ? 'Linux'
                : t('settings.info.unknownPlatform', 'Unknown Platform');
  const arch = platformQuery.data?.arch ?? currentPlatform.arch ?? 'unknown';
  const platformLabel = `${osLabel} (${arch})`;

  const report =
    platformQuery.data && storageQuery.data
      ? buildDiagnosticsReport({
          platform: {
            os: platformQuery.data.os,
            arch: platformQuery.data.arch,
            appVersion: platformQuery.data.appVersion,
            buildProfile: platformQuery.data.buildProfile,
          },
          storage: {
            status: storageQuery.data.status,
            journalMode: storageQuery.data.journalMode,
            schemaVersion: storageQuery.data.schemaVersion,
          },
        })
      : null;

  // Awaited clipboard: success and failure are both explicit — a failed copy
  // never shows a confirmation.
  const handleCopyDiagnostics = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('failed');
    }
  };

  const loading = platformQuery.isPending || storageQuery.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.info.title', { defaultValue: 'About Adham' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.info.desc', {
            defaultValue: 'Application build details, runtime engines, and platform diagnostics.',
          })}
        </p>
      </div>

      {/* System Details Section */}
      <section aria-labelledby="app-details-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="app-details-heading" className="text-sm font-semibold text-foreground">
            {t('settings.info.detailsTitle', 'Application details')}
          </h3>
        </div>
        {loading && (
          <p role="status" className="text-xs text-foreground-secondary">
            {t('settings.info.loadingDetails', 'Loading application details…')}
          </p>
        )}
        {!loading && !platformQuery.data && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-foreground-secondary">
              {t(
                'settings.info.detailsUnavailable',
                'Application details are unavailable. Retry from Data settings if storage is down.',
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void platformQuery.refetch();
                void storageQuery.refetch();
              }}
            >
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {platformQuery.data && (
          <div className="space-y-4">
            {/* Version (backend build identity, never a hardcoded literal) */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.versionLabel', 'App version')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t('settings.info.versionHint', 'Current installed client release')}
                </div>
              </div>
              <span className="font-mono text-xs font-semibold text-foreground">
                {platformQuery.data.appVersion}
              </span>
            </div>

            {/* Build profile */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.buildProfileLabel', 'Build profile')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t('settings.info.buildProfileHint', 'Which pipeline produced this binary')}
                </div>
              </div>
              <span className="font-mono text-xs text-foreground-secondary">
                {platformQuery.data.buildProfile}
              </span>
            </div>

            {/* Runtime Engine (static stack fact, not a measured value) */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.runtimeLabel', 'Runtime architecture')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t('settings.info.runtimeHint', 'Native process isolation and backend bindings')}
                </div>
              </div>
              <span className="text-xs text-foreground-secondary">
                {t('settings.info.engineValue', 'Tauri v2 + Rust Core')}
              </span>
            </div>

            {/* Database (live journal mode, not a version literal) */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.databaseLabel', 'Database')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t('settings.info.databaseHint', 'Local event store and its journal mode')}
                </div>
              </div>
              <span className="text-xs text-foreground-secondary">
                {storageQuery.data
                  ? t('settings.info.databaseValue', 'SQLite ({{mode}})', {
                      mode: storageQuery.data.journalMode,
                    })
                  : t('settings.info.databaseUnknown', 'SQLite (unknown)')}
              </span>
            </div>

            {/* Platform */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.platformLabel', 'Host platform')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t('settings.info.platformHint', 'Operating system and target architecture')}
                </div>
              </div>
              <span className="text-xs text-foreground-secondary">{platformLabel}</span>
            </div>
          </div>
        )}
      </section>

      {/* Diagnostics Section (explicit allowlist with preview) */}
      <section aria-labelledby="diagnostics-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="diagnostics-heading" className="text-sm font-semibold text-foreground">
            {t('settings.info.diagnosticsTitle', 'Diagnostics & updates')}
          </h3>
        </div>
        <div className="space-y-4">
          {/*
            The automatic-update toggle is intentionally gone: no updater
            exists, so it was a placebo. It returns with its own contract if
            Stable/Beta channels (spec §16) are ever implemented.
          */}
          {report ? (
            <>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('settings.info.previewTitle', 'Report preview')}
                </div>
                <div className="text-xs text-foreground-secondary mt-0.5">
                  {t(
                    'settings.info.previewHint',
                    'Exactly what gets copied — versions and status only, no paths or content.',
                  )}
                </div>
                <pre
                  data-testid="diagnostics-preview"
                  className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-subtle p-3 font-mono text-xs text-foreground-secondary"
                >
                  {JSON.stringify(report, null, 2)}
                </pre>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t('settings.info.copyReportLabel', 'Copy diagnostic report')}
                  </div>
                  <div className="text-xs text-foreground-secondary mt-0.5">
                    {t(
                      'settings.info.copyReportHint',
                      'Export sanitized environment info for troubleshooting',
                    )}
                  </div>
                  {copyState === 'failed' && (
                    <div role="alert" className="text-xs text-destructive font-medium mt-1">
                      {t(
                        'settings.info.copyFailed',
                        'Copy failed — select the preview and copy it manually.',
                      )}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="secondary" onClick={() => void handleCopyDiagnostics()}>
                  {copyState === 'copied'
                    ? t('settings.info.copied', 'Copied ✓')
                    : t('settings.info.copyJson', 'Copy JSON')}
                </Button>
              </div>
            </>
          ) : (
            !loading && (
              <p role="status" className="text-xs text-foreground-secondary">
                {t(
                  'settings.info.reportUnavailable',
                  'The diagnostic report loads with storage and platform information.',
                )}
              </p>
            )
          )}
        </div>
      </section>
    </div>
  );
}
