import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewNote } from '../preview-note';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  McpServerIcon,
  GlobalSearchIcon,
  Folder01Icon,
  Database01Icon,
  GitBranchIcon,
  SourceCodeIcon,
} from '@hugeicons/core-free-icons';
import {
  McpFilterTabs,
  type McpFilterTab,
  McpServersList,
  type McpServerItem,
  McpSandboxSection,
} from './components';

export function McpPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<McpFilterTab>('all');
  // No MCP server is configured in this build: per-tool grants (spec §10)
  // do not exist yet, so nothing may claim to be configured.
  const [configuredIds, setConfiguredIds] = React.useState<Set<string>>(() => new Set());

  const mcpServers: McpServerItem[] = [
    {
      id: 'playwright',
      name: 'Playwright',
      desc: t(
        'settings.mcp.descPlaywright',
        'Browser automation server bounded to local scratch directory.',
      ),
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      transport: 'stdio',
      category: 'automation',
    },
    {
      id: 'filesystem',
      name: 'FileSystem',
      desc: t(
        'settings.mcp.descFilesystem',
        'Sandboxed directory operations and workspace filesystem bridge.',
      ),
      icon: <HugeiconsIcon icon={Folder01Icon} />,
      transport: 'stdio',
      category: 'filesystem',
    },
    {
      id: 'context7',
      name: 'Context7',
      desc: t(
        'settings.mcp.descContext7',
        'Up-to-date documentation indexer and library research server.',
      ),
      icon: <HugeiconsIcon icon={McpServerIcon} />,
      transport: 'sse',
      category: 'knowledge',
    },
    {
      id: 'github',
      name: 'GitHub',
      desc: t(
        'settings.mcp.descGithub',
        'Connect repositories, issues, and pull requests into agent tasks.',
      ),
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      transport: 'stdio',
      category: 'development',
    },
    {
      id: 'database',
      name: 'PostgreSQL',
      desc: t(
        'settings.mcp.descDatabase',
        'Read schemas and safely run inspected queries on local databases.',
      ),
      icon: <HugeiconsIcon icon={Database01Icon} />,
      transport: 'stdio',
      category: 'database',
    },
    {
      id: 'vscode',
      name: 'Editor Bridge',
      desc: t(
        'settings.mcp.descVscode',
        'Synchronize active files and diagnostics with desktop editor.',
      ),
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      transport: 'stdio',
      category: 'ide',
    },
    {
      id: 'brave-search',
      name: 'Brave Search',
      desc: t('settings.mcp.descBrave', 'Live web search API and structured query retrieval.'),
      icon: <img src="/media/software/brave.svg" alt="Brave" className="size-5 object-contain" />,
      transport: 'sse',
      category: 'search',
    },
    {
      id: 'governed-memory',
      name: 'Governed Memory',
      desc: t('settings.mcp.descMemory', 'Vector retrieval and durable session knowledge store.'),
      icon: <HugeiconsIcon icon={McpServerIcon} />,
      transport: 'stdio',
      category: 'memory',
    },
  ];

  const handleToggle = (id: string) => {
    setConfiguredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredServers = mcpServers.filter((s) => {
    if (tab === 'configured') return configuredIds.has(s.id);
    if (tab === 'available') return !configuredIds.has(s.id);
    return true;
  });

  const counts = {
    all: mcpServers.length,
    configured: configuredIds.size,
    available: mcpServers.length - configuredIds.size,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.mcp.title', 'Model Context Protocol')}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          {t(
            'settings.mcp.desc',
            'Connect tools, local databases, and external environments via standard MCP servers.',
          )}
        </p>
      </div>

      <PreviewNote />

      {/* Sandbox & Isolation Note */}
      <McpSandboxSection />

      {/* Branded Filter Tabs */}
      <McpFilterTabs activeTab={tab} onTabChange={setTab} counts={counts} />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="mcp-servers-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="mcp-servers-heading" className="text-sm font-semibold text-foreground">
            {t('settings.mcp.listTitle', 'Servers to use with Adham')}
          </h3>
        </div>

        {/* Dynamic MCP Servers List (not connected: disabled preview) */}
        <fieldset disabled className="min-w-0 border-0 p-0 m-0">
          <McpServersList
            servers={filteredServers}
            configuredIds={configuredIds}
            onToggle={handleToggle}
          />
        </fieldset>
      </section>

      {/* Footer Documentation Link */}
      <div className="pt-2 text-xs text-foreground-secondary">
        {t(
          'settings.mcp.footerLead',
          'Want to bring your own local databases, APIs, or custom servers? ',
        )}{' '}
        <span className="text-action cursor-pointer hover:underline">
          {t('settings.mcp.footerLink', 'Documentation & guides →')}
        </span>
      </div>
    </div>
  );
}
