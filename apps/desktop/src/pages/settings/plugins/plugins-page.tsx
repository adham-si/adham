import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@adham/ui';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  PuzzleIcon,
  GitBranchIcon,
  SourceCodeIcon,
  TerminalIcon,
  ShieldIcon,
  ComputerIcon,
  GlobalSearchIcon,
  Database01Icon,
} from '@hugeicons/core-free-icons';
import { PluginFilterTabs, type PluginFilterTab, PluginsList, type PluginItem } from './components';

export function PluginsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<PluginFilterTab>('all');
  const [installedIds, setInstalledIds] = React.useState<Set<string>>(
    () => new Set(['core-tools', 'linter-sync', 'security-guard']),
  );

  const plugins: PluginItem[] = [
    {
      id: 'core-tools',
      name: 'Adham Core Tools',
      desc: 'Foundational workspace runtime and core execution primitives.',
      icon: <HugeiconsIcon icon={PuzzleIcon} />,
      category: 'core',
    },
    {
      id: 'git-bridge',
      name: 'Git Automation',
      desc: 'Inspect commit history, manage branches, and automate safe staging.',
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      category: 'git',
    },
    {
      id: 'linter-sync',
      name: 'Diagnostic Bridge',
      desc: 'Live linter diagnostics, type-checking, and compiler error inspection.',
      icon: <HugeiconsIcon icon={SourceCodeIcon} />,
      category: 'dx',
    },
    {
      id: 'terminal-runner',
      name: 'Terminal Sandbox',
      desc: 'Execute shell tasks in isolated environments with safety approval.',
      icon: <HugeiconsIcon icon={TerminalIcon} />,
      category: 'shell',
    },
    {
      id: 'docker-env',
      name: 'Container Bridge',
      desc: 'Orchestrate Docker containers, background services, and test runtimes.',
      icon: <HugeiconsIcon icon={ComputerIcon} />,
      category: 'infra',
    },
    {
      id: 'security-guard',
      name: 'Security Guard',
      desc: 'Verify package signatures, integrity checksums, and execution permissions.',
      icon: <HugeiconsIcon icon={ShieldIcon} />,
      category: 'security',
    },
    {
      id: 'browser-bridge',
      name: 'Browser Automation',
      desc: 'Inspect web apps, capture DOM snapshots, and automate browser tasks.',
      icon: <HugeiconsIcon icon={GlobalSearchIcon} />,
      category: 'browser',
    },
    {
      id: 'db-bridge',
      name: 'Database Connector',
      desc: 'Connect databases with schema inspection and safe query execution.',
      icon: <HugeiconsIcon icon={Database01Icon} />,
      category: 'data',
    },
  ];

  const handleToggle = (id: string) => {
    setInstalledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredPlugins = plugins.filter((p) => {
    if (tab === 'installed') return installedIds.has(p.id);
    if (tab === 'available') return !installedIds.has(p.id);
    return true;
  });

  const counts = {
    all: plugins.length,
    installed: installedIds.size,
    available: plugins.length - installedIds.size,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {t('settings.extensions.plugins', { defaultValue: 'Plugins' })}
        </h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Extend your agent workspace with development tools, bridges, and integrations.
        </p>
      </div>

      {/* Branded Filter Tabs */}
      <PluginFilterTabs activeTab={tab} onTabChange={setTab} counts={counts} />

      {/* Section Header with Action and Notion-style separator line */}
      <section aria-labelledby="plugins-heading" className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
          <h3 id="plugins-heading" className="text-sm font-semibold text-foreground">
            Verified Extensions
          </h3>
          <Button size="sm" variant="primary" className="[&_svg]:size-icon-sm">
            <HugeiconsIcon icon={Add01Icon} />
            <span>Install plugin</span>
          </Button>
        </div>

        {/* Dynamic Plugins List Grid */}
        <PluginsList
          plugins={filteredPlugins}
          installedIds={installedIds}
          onToggle={handleToggle}
        />
      </section>

      {/* Footer Security Note */}
      <div className="pt-2 text-xs text-foreground-secondary">
        Plugins execute in isolated subprocesses with restricted IPC access.{' '}
        <span className="text-action cursor-pointer hover:underline">
          Security architecture guide →
        </span>
      </div>
    </div>
  );
}
