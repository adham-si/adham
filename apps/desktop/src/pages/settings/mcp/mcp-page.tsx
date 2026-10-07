import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  McpServerIcon,
  GlobalSearchIcon,
  Folder01Icon,
  Database01Icon,
  GitBranchIcon,
  SourceCodeIcon,
} from '@hugeicons/core-free-icons';

export function McpPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<'discover' | 'manage'>('discover');

  const mcpServers = [
    {
      id: 'playwright',
      name: 'Playwright',
      desc: 'Browser automation server bounded to local scratch directory.',
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      status: 'active',
      buttonText: 'Configured',
    },
    {
      id: 'filesystem',
      name: 'FileSystem',
      desc: 'Sandboxed directory operations and workspace filesystem bridge.',
      icon: <HugeiconsIcon icon={Folder01Icon} />,
      status: 'active',
      buttonText: 'Configured',
    },
    {
      id: 'context7',
      name: 'Context7',
      desc: 'Up-to-date documentation indexer and library research server.',
      icon: <HugeiconsIcon icon={McpServerIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'github',
      name: 'GitHub',
      desc: 'Connect repositories, issues, and pull requests into agent tasks.',
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'database',
      name: 'PostgreSQL',
      desc: 'Read schemas and safely run inspected queries on local databases.',
      icon: <HugeiconsIcon icon={Database01Icon} />,
      status: 'available',
      buttonText: 'Enable',
    },
    {
      id: 'vscode',
      name: 'Editor Bridge',
      desc: 'Synchronize active files and diagnostics with desktop editor.',
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      status: 'available',
      buttonText: 'Enable',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.extensions.mcp', { defaultValue: 'Model Context Protocol (MCP)' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Use MCP servers to connect tools, local databases, and external environments.{' '}
          <span className="text-action cursor-pointer hover:underline">Learn more</span>
        </p>
      </div>

      {/* Pill sub-tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('discover')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'discover'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Discover MCP servers
        </button>
        <button
          type="button"
          onClick={() => setTab('manage')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'manage'
              ? 'bg-surface-muted text-foreground'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          Manage active servers
        </button>
      </div>

      {/* Section Header with Action Button */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold text-foreground">Servers to use with Adham</h3>
        <Button size="sm" variant="primary">
          + Add an MCP server
        </Button>
      </div>

      {/* 2-Column Grid (Image 2 style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {mcpServers.map((server) => {
          const isConfigured = server.status === 'active';
          return (
            <div
              key={server.id}
              className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-surface-subtle"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-foreground [&_svg]:size-icon-sm">
                  {server.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {server.name}
                  </div>
                  <div className="text-xs text-foreground-secondary truncate max-w-[180px] sm:max-w-[220px]">
                    {server.desc}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant={isConfigured ? 'secondary' : 'secondary'}
                className="ms-3 shrink-0"
              >
                {server.buttonText}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Footer connection link */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Want to bring your own local databases, APIs, or custom servers?{' '}
        <span className="text-action cursor-pointer hover:underline">Documentation & guides →</span>
      </div>
    </div>
  );
}
