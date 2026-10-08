import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function PrivacyPage() {
  const { t } = useTranslation();
  const [crashReports, setCrashReports] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState(false);
  const [sandboxBoundary, setSandboxBoundary] = React.useState(true);
  const [blockOutbound, setBlockOutbound] = React.useState(true);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.privacy.title', { defaultValue: 'Privacy & Security' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t('settings.privacy.desc', {
            defaultValue:
              'Configure telemetry policies, host credential protections, and execution isolation.',
          })}
        </p>
      </div>

      {/* Telemetry Section */}
      <section aria-labelledby="telemetry-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="telemetry-heading" className="text-sm font-semibold text-foreground">
            Telemetry & analytics
          </h3>
        </div>
        <div className="space-y-4">
          {/* Crash Reports */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Anonymous crash reports</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Automatically send anonymized crash dumps to improve system stability
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={crashReports}
              aria-label="Anonymous crash reports"
              onClick={() => setCrashReports(!crashReports)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                crashReports ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  crashReports ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Diagnostic Metrics */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Share usage analytics</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Help improve Adham by sharing anonymous feature interaction counts
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={diagnostics}
              aria-label="Share usage analytics"
              onClick={() => setDiagnostics(!diagnostics)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                diagnostics ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  diagnostics ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Network & Egress Section */}
      <section aria-labelledby="isolation-heading" className="space-y-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h3 id="isolation-heading" className="text-sm font-semibold text-foreground">
            Isolation & egress
          </h3>
        </div>
        <div className="space-y-4">
          {/* Sandbox Isolation */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Strict sandbox containment</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Execute subagent tools in bounded staging directories without ambient host secrets
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sandboxBoundary}
              aria-label="Strict sandbox containment"
              onClick={() => setSandboxBoundary(!sandboxBoundary)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                sandboxBoundary ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  sandboxBoundary ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Block Tool Network Egress */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Block tool network egress</div>
              <div className="text-xs text-foreground-secondary mt-0.5">
                Prevent sandboxed tools from making external HTTP/TCP requests
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={blockOutbound}
              aria-label="Block tool network egress"
              onClick={() => setBlockOutbound(!blockOutbound)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                blockOutbound ? 'bg-action' : 'bg-surface-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-surface shadow-sm transition-transform ${
                  blockOutbound ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
