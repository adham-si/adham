import * as React from 'react';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
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
  const [tab, setTab] = React.useState<McpFilterTab>('all');
  const [configuredIds, setConfiguredIds] = React.useState<Set<string>>(
    () => new Set(['playwright', 'filesystem']),
  );

  const mcpServers: McpServerItem[] = [
    {
      id: 'playwright',
      name: 'Playwright',
      desc: 'Browser automation server bounded to local scratch directory.',
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      transport: 'stdio',
      category: 'automation',
    },
    {
      id: 'filesystem',
      name: 'FileSystem',
      desc: 'Sandboxed directory operations and workspace filesystem bridge.',
      icon: <HugeiconsIcon icon={Folder01Icon} />,
      transport: 'stdio',
      category: 'filesystem',
    },
    {
      id: 'context7',
      name: 'Context7',
      desc: 'Up-to-date documentation indexer and library research server.',
      icon: <HugeiconsIcon icon={McpServerIcon} />,
      transport: 'sse',
      category: 'knowledge',
    },
    {
      id: 'github',
      name: 'GitHub',
      desc: 'Connect repositories, issues, and pull requests into agent tasks.',
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      transport: 'stdio',
      category: 'development',
    },
    {
      id: 'database',
      name: 'PostgreSQL',
      desc: 'Read schemas and safely run inspected queries on local databases.',
      icon: <HugeiconsIcon icon={Database01Icon} />,
      transport: 'stdio',
      category: 'database',
    },
    {
      id: 'vscode',
      name: 'Editor Bridge',
      desc: 'Synchronize active files and diagnostics with desktop editor.',
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      transport: 'stdio',
      category: 'ide',
    },
    {
      id: 'brave-search',
      name: 'Brave Search',
      desc: 'Live web search API and structured query retrieval.',
      icon: <img src="/media/software/brave.svg" alt="Brave" className="size-5 object-contain" />,
      transport: 'sse',
      category: 'search',
    },
    {
      id: 'governed-memory',
      name: 'Governed Memory',
      desc: 'Vector retrieval and durable session knowledge store.',
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
        <h2 className="text-xl font-bold tracking-tight text-foreground">Model Context Protocol</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Connect tools, local databases, and external environments via standard MCP servers.
        </p>
      </div>

      {/* Sandbox & Isolation Note */}
      <McpSandboxSection />

      {/* Branded Filter Tabs */}
      <McpFilterTabs activeTab={tab} onTabChange={setTab} counts={counts} />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="mcp-servers-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="mcp-servers-heading" className="text-sm font-semibold text-foreground">
            Servers to use with Adham
          </h3>
          <Button size="sm" variant="primary" className="[&_svg]:size-icon-sm">
            <HugeiconsIcon icon={Add01Icon} />
            <span>Add server</span>
          </Button>
        </div>

        {/* Dynamic MCP Servers List */}
        <McpServersList
          servers={filteredServers}
          configuredIds={configuredIds}
          onToggle={handleToggle}
        />
      </section>

      {/* Footer Documentation Link */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Want to bring your own local databases, APIs, or custom servers?{' '}
        <span className="text-action cursor-pointer hover:underline">Documentation & guides →</span>
      </div>
    </div>
  );
}
