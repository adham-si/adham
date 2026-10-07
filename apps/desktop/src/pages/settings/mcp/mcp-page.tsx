import * as React from 'react';
import { useTranslation } from 'react-i18next';

export function McpPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('settings.extensions.mcp')}</h3>
        <p className="text-xs text-foreground-secondary">
          Configure Model Context Protocol servers, transport protocols, and tool policy grants.
        </p>
      </div>

      {/* Governed Status */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Protocol Status
          </div>
          <span className="rounded bg-selection px-2 py-0.5 text-xs text-action font-medium">
            P0-13 Governed
          </span>
        </div>
        <p className="text-xs text-foreground-secondary">
          All client MCP servers operate under strict project-scoped permissions. Stdio and SSE
          transports require verified binaries.
        </p>
      </div>

      {/* Configured MCP Servers */}
      <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Active Servers
        </div>
        <div className="rounded border border-border-subtle bg-surface p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">playwright-mcp</span>
            <span className="text-success text-xs font-medium">Ready</span>
          </div>
          <p className="text-foreground-secondary text-xs">
            Browser automation server bounded to local scratch directory.
          </p>
        </div>
      </div>
    </div>
  );
}
