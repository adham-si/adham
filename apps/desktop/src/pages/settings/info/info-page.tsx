import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';

export function InfoPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const sysInfo = {
    version: '0.1.0-alpha',
    build: '2026.10.07-nightly',
    engine: 'Tauri v2 + Rust Core',
    database: 'SQLite v3.45 (WAL Mode)',
    platform: 'Windows x86_64',
    license: 'Dual MIT / Apache-2.0',
  };

  const handleCopyDiagnostics = () => {
    navigator.clipboard.writeText(JSON.stringify(sysInfo, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {t('settings.info.title', { defaultValue: 'System Info & Diagnostics' })}
        </h3>
        <p className="text-xs text-foreground-secondary">
          {t('settings.info.desc', {
            defaultValue: 'Application build details, runtime engines, and platform diagnostics.',
          })}
        </p>
      </div>

      {/* Build and Environment */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Environment & Engine
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">App Version</span>
            <span className="font-mono text-foreground font-medium">{sysInfo.version}</span>
          </div>
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">Build</span>
            <span className="font-mono text-foreground">{sysInfo.build}</span>
          </div>
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">Runtime</span>
            <span className="font-mono text-foreground">{sysInfo.engine}</span>
          </div>
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">Database</span>
            <span className="font-mono text-foreground">{sysInfo.database}</span>
          </div>
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">Platform</span>
            <span className="font-mono text-foreground">{sysInfo.platform}</span>
          </div>
          <div className="flex justify-between border-b border-border-subtle pb-1.5">
            <span className="text-foreground-secondary">License</span>
            <span className="font-mono text-foreground">{sysInfo.license}</span>
          </div>
        </div>
      </div>

      {/* Diagnostic Actions */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Support & Diagnostics
        </div>
        <p className="text-xs text-foreground-secondary">
          Export sanitized diagnostic payload containing only system capabilities and runtime
          versions.
        </p>
        <Button size="sm" variant="secondary" onClick={handleCopyDiagnostics}>
          {copied ? 'Copied to Clipboard!' : 'Copy Diagnostic Report'}
        </Button>
      </div>
    </div>
  );
}
