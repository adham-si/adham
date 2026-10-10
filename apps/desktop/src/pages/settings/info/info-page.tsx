import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { getPlatform } from '@/shared/platform';

export function InfoPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const [autoUpdate, setAutoUpdate] = React.useState(true);

  const currentPlatform = getPlatform();
  const platformLabel = currentPlatform.isMac
    ? 'macOS (Darwin)'
    : currentPlatform.isWindows
      ? 'Windows x86_64'
      : currentPlatform.isLinux
        ? 'Linux'
        : 'Unknown Platform';

  const sysInfo = {
    version: '0.1.0-alpha',
    build: '2026.10.07-nightly',
    engine: 'Tauri v2 + Rust Core',
    database: 'SQLite v3.45 (WAL Mode)',
    platform: platformLabel,
    license: 'Dual MIT / Apache-2.0',
  };

  const handleCopyDiagnostics = () => {
    navigator.clipboard.writeText(JSON.stringify(sysInfo, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
            Application details
          </h3>
        </div>
        <div className="space-y-4">
          {/* Version */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">App version</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Current installed client release
              </div>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground">
              {sysInfo.version}
            </span>
          </div>

          {/* Build */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Build identifier</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Git revision and compiler pipeline
              </div>
            </div>
            <span className="font-mono text-xs text-foreground-secondary">{sysInfo.build}</span>
          </div>

          {/* Runtime Engine */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Runtime architecture</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Native process isolation and backend bindings
              </div>
            </div>
            <span className="text-xs text-foreground-secondary">{sysInfo.engine}</span>
          </div>

          {/* Platform */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Host platform</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Operating system and target architecture
              </div>
            </div>
            <span className="text-xs text-foreground-secondary">{sysInfo.platform}</span>
          </div>
        </div>
      </section>

      {/* Diagnostics & Updates Section */}
      <section aria-labelledby="diagnostics-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="diagnostics-heading" className="text-sm font-semibold text-foreground">
            Diagnostics & updates
          </h3>
        </div>
        <div className="space-y-4">
          {/* Auto-update Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                Check for updates automatically
              </div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Notify when new releases or security patches are available
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoUpdate}
              aria-label="Check for updates automatically"
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                autoUpdate ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  autoUpdate ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Copy Diagnostics Button */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Copy diagnostic report</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Export sanitized environment info for troubleshooting
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={handleCopyDiagnostics}>
              {copied ? 'Copied ✓' : 'Copy JSON'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
